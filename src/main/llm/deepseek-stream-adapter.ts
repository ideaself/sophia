/**
 * DeepSeek SSE streaming fetch adapter.
 *
 * Implementation of DeepSeekStreamAdapter using raw fetch() +
 * ReadableStream. Parses Server-Sent Events (SSE) from the DeepSeek
 * streaming Chat Completions endpoint and yields DeepSeekStreamChunk
 * objects as an async iterable.
 *
 * The adapter is injected — tests provide a mock fetchImpl so no
 * network access or real API key is required.
 *
 * DeepSeek streaming protocol:
 * - POST https://api.deepseek.com/chat/completions
 * - Body: { model, messages, stream: true, stream_options: { include_usage: true } }
 * - Response: text/event-stream with lines "data: {...}\n\n"
 * - Sentinel: "data: [DONE]"
 * - Usage may arrive in final chunk or dedicated choices:[] chunk before DONE
 */

import type {
  DeepSeekStreamAdapter,
  DeepSeekStreamChunk,
  DeepSeekStreamParams
} from './stream-types'
import { AppError, mapDeepSeekError } from './errors'
import { assertHttpsEndpoint } from './endpoint'
import { sleepWithAbort, createAbortError } from './sleep'

// ---------------------------------------------------------------
// Constants
// ---------------------------------------------------------------

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions'

/**
 * Abort when the provider sends no bytes for this long. The session-level
 * 5-minute cap only bounds total duration; without an idle guard a hung
 * connection keeps the user waiting for the full cap.
 */
const DEFAULT_IDLE_TIMEOUT_MS = 90_000

// ---------------------------------------------------------------
// Factory
// ---------------------------------------------------------------

/**
 * Create a DeepSeekStreamAdapter.
 *
 * @param options.endpoint      Override the default API endpoint URL.
 * @param options.fetchImpl     Inject a custom fetch implementation (for testing).
 * @param options.idleTimeoutMs Abort after this long without data (0 disables).
 */
export function createDeepSeekStreamAdapter(options?: {
  endpoint?: string
  fetchImpl?: typeof fetch
  idleTimeoutMs?: number
}): DeepSeekStreamAdapter {
  const defaultEndpoint = options?.endpoint ?? DEFAULT_ENDPOINT
  const fetchImpl = options?.fetchImpl ?? fetch
  const idleTimeoutMs = options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS

  assertHttpsEndpoint(defaultEndpoint)

  return {
    streamChat: async function* (
      params: DeepSeekStreamParams
    ): AsyncIterable<DeepSeekStreamChunk> {
      // Use per-request endpoint override if provided
      let endpoint = defaultEndpoint
      if (params._endpoint) {
        const base = params._endpoint.replace(/\/$/, '')
        endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
      }
      // The override comes from user-configured providers — enforce the
      // same HTTPS rule before the API key leaves the machine.
      assertHttpsEndpoint(endpoint)

      // Retry the initial HTTP connection on transient errors (429/500/503)
      // before any data is streamed. Once streaming begins, retries are
      // not possible (partial output has already been consumed).
      const MAX_RETRIES = 2
      let response: Response | null = null

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (params.signal?.aborted) {
          throw createAbortError()
        }

        try {
          response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${params.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: params.model,
              messages: params.messages,
              stream: true,
              stream_options: { include_usage: true },
              ...(params.thinking ? { thinking: { type: 'enabled' } } : {})
            }),
            signal: params.signal
          })
        } catch (err) {
          if (params.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
            throw err
          }
          if (attempt < MAX_RETRIES) {
            await sleepWithAbort(1000 * Math.pow(2, attempt), params.signal)
            continue
          }
          throw err
        }

        if (response.ok) break

        // Non-2xx -> map to AppError, retry if transient
        let body: Record<string, unknown> | undefined
        try {
          body = (await response.json()) as Record<string, unknown>
        } catch {
          // Body is not valid JSON - leave body undefined so the
          // fallback message is used.
        }

        const error = mapDeepSeekError(response.status, body)

        if (error.retryable && attempt < MAX_RETRIES) {
          await sleepWithAbort(1000 * Math.pow(2, attempt), params.signal)
          continue
        }

        throw error
      }

      // ---------------------------------------------------------
      // 2xx but no readable body -> error
      // ---------------------------------------------------------
      if (!response || !response.body) {
        throw new AppError(
          'STREAM_ERROR',
          0,
          'Response body is null — cannot read stream'
        )
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let skippedLines = 0
      let warnedSkipped = false

      try {
        while (true) {
          const result = await readWithIdleTimeout(reader, idleTimeoutMs)

          if (result.done) {
            // Flush decoder for any multi-byte leftovers, then
            // process the final buffer (isFinal = true so the
            // last line is treated as complete).
            buffer += decoder.decode()
            const outcome = processLines(buffer, true)
            for (const chunk of outcome.chunks) yield chunk
            skippedLines += outcome.skipped
            if (skippedLines > 0 && !warnedSkipped) {
              warnedSkipped = true
              console.warn(`[stream] skipped ${skippedLines} malformed SSE line(s)`)
            }
            return
          }

          // Append decoded bytes.  stream:true prevents the decoder
          // from emitting replacement characters for incomplete
          // multi-byte sequences at chunk boundaries.
          buffer += decoder.decode(result.value, { stream: true })

          const outcome = processLines(buffer, false)

          // Keep only the incomplete trailing line for the next
          // read iteration.
          buffer = outcome.remainder

          for (const chunk of outcome.chunks) yield chunk
          skippedLines += outcome.skipped
          if (skippedLines > 0 && !warnedSkipped) {
            warnedSkipped = true
            console.warn(`[stream] skipped ${skippedLines} malformed SSE line(s)`)
          }
          if (outcome.doneReceived) return
        }
      } catch (err) {
        // Detach the stalled connection before surfacing the timeout.
        if (err instanceof AppError && err.code === 'STREAM_IDLE_TIMEOUT') {
          await reader.cancel().catch(() => {})
        }
        throw err
      } finally {
        // Release the reader lock so the underlying connection can
        // be torn down.
        try {
          reader.releaseLock()
        } catch {
          // Reader may already be released (e.g. after a cancel).
        }
      }
    }
  }
}

// ---------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------

/**
 * Race a stream read against an idle timeout. A provider that connects but
 * then goes silent surfaces as a clear STREAM_IDLE_TIMEOUT instead of
 * hanging until the session's total cap.
 */
function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (timeoutMs <= 0) return reader.read()
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new AppError(
          'STREAM_IDLE_TIMEOUT',
          0,
          `模型 ${Math.round(timeoutMs / 1000)} 秒未返回数据，已自动中止`
        )
      )
    }, timeoutMs)
  })
  return Promise.race([reader.read(), timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

// ---------------------------------------------------------------
// SSE line processing
// ---------------------------------------------------------------

interface ProcessResult {
  chunks: DeepSeekStreamChunk[]
  doneReceived: boolean
  remainder: string
  /** Malformed data lines that were skipped instead of failing the stream. */
  skipped: number
}

/**
 * Split the buffer into complete lines (terminated by \n) and parse
 * each SSE data line.
 *
 * When `isFinal` is true the final element after the last \n is also
 * processed as a complete line (the stream has ended).
 *
 * When `isFinal` is false the element after the last \n is kept as
 * the `remainder` for the next read cycle.
 *
 * A single malformed line (proxy keep-alive noise, truncated chunk) is
 * skipped and counted — one bad line must not throw away a whole answer.
 */
function processLines(buffer: string, isFinal: boolean): ProcessResult {
  const lines = buffer.split('\n')
  const chunks: DeepSeekStreamChunk[] = []
  let skipped = 0

  // The last element may be an incomplete line — skip it unless
  // this is the final flush.
  const end = isFinal ? lines.length : lines.length - 1

  for (let i = 0; i < end; i++) {
    const line = lines[i]

    // Skip empty lines and SSE comment lines (starting with colon).
    if (line === '' || line.startsWith(':')) continue

    const trimmed = line.trimStart()
    if (trimmed.startsWith('data: ')) {
      const data = trimmed.slice(6)
      if (data === '[DONE]') {
        return { chunks, doneReceived: true, remainder: '', skipped }
      }
      const chunk = parseChunk(data)
      if (chunk) {
        chunks.push(chunk)
      } else {
        skipped++
      }
    }
  }

  // Compute the incomplete remainder (everything after the last \n).
  const lastIdx = buffer.lastIndexOf('\n')
  const remainder = lastIdx === -1 ? buffer : buffer.slice(lastIdx + 1)

  return { chunks, doneReceived: false, remainder, skipped }
}

// ---------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------

/**
 * Parse a data string into a DeepSeekStreamChunk.
 *
 * Malformed JSON returns null (the line is skipped by the caller) — the raw
 * data is never surfaced in errors to avoid leaking API keys or payloads.
 */
function parseChunk(data: string): DeepSeekStreamChunk | null {
  try {
    return JSON.parse(data) as DeepSeekStreamChunk
  } catch {
    return null
  }
}
