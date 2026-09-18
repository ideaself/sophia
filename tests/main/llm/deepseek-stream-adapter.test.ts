/**
 * Tests for DeepSeekStreamAdapter — the SSE streaming fetch adapter.
 *
 * All tests inject a mock fetch implementation so no real network
 * calls or API keys are used.
 *
 * Coverage:
 * - Request headers, body, URL, and signal verification
 * - Normal SSE chunk parsing (token, finish_reason)
 * - Multiple SSE events in a single buffer read
 * - Partial SSE events split across buffer reads
 * - [DONE] sentinel termination
 * - Usage chunk with empty choices array
 * - Non-2xx HTTP status → AppError mapping
 * - AbortSignal propagation
 * - Malformed JSON sanitization (no key leak)
 * - Custom endpoint override
 * - Empty lines and SSE comment lines
 * - Response body is null (edge case)
 */

import { describe, it, expect, vi } from 'vitest'

import type { DeepSeekStreamChunk, DeepSeekStreamParams } from '../../../src/main/llm/stream-types'
import type { DeepSeekChatMessage } from '../../../src/main/llm/types'
import { AppError } from '../../../src/main/llm/errors'

// ---------------------------------------------------------------
// Import the factory under test
// ---------------------------------------------------------------

import { createDeepSeekStreamAdapter } from '../../../src/main/llm/deepseek-stream-adapter'

// ---------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------

const testMessages: DeepSeekChatMessage[] = [
  { role: 'user', content: 'Hello' }
]

const testApiKey = 'sk-test-deepseek-adapter-key-123'

interface CapturedCall {
  input: RequestInfo | URL
  init?: RequestInit
}

/**
 * Create a mock fetch function that returns a Response with the given
 * HTTP status.  For 2xx responses the body is a ReadableStream built
 * from the supplied string chunks (simulating network TCP segments).
 * For non-2xx the body is a JSON error blob.
 */
function mockFetch(
  status: number,
  bodyChunks?: string[]
): {
  fetchFn: typeof fetch
  calls: CapturedCall[]
} {
  const calls: CapturedCall[] = []

  const fetchFn = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ input, init })

    if (status >= 200 && status < 300 && bodyChunks !== undefined) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of bodyChunks) {
            controller.enqueue(encoder.encode(chunk))
          }
          controller.close()
        }
      })
      return Promise.resolve(new Response(stream, { status }))
    }

    return Promise.resolve(
      new Response(JSON.stringify({ error: { message: `test error ${status}` } }), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  }

  return { fetchFn: fetchFn as unknown as typeof fetch, calls }
}

/**
 * Create a mock fetch that returns a response whose body is null
 * (simulating a response where .body is unavailable).
 */
function mockFetchNullBody(): { fetchFn: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = []

  const fetchFn = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ input, init })
    // Use Response constructor without body → body will be null
    const response = new Response(null, { status: 200 })
    // Override body to null (Response might set it to a non-null default)
    Object.defineProperty(response, 'body', { value: null })
    return Promise.resolve(response)
  }

  return { fetchFn: fetchFn as unknown as typeof fetch, calls }
}

/**
 * Build SSE data lines from chunks, joining with double newlines.
 */
function sseLines(lines: string[]): string {
  return lines.map((l) => l + '\n\n').join('')
}

/**
 * Build a single SSE data line from a JSON object.
 */
function sseData(json: Record<string, unknown>): string {
  return `data: ${JSON.stringify(json)}`
}

/**
 * Shortcut: create a DeepSeekStreamParams object.
 */
function streamParams(overrides?: Partial<DeepSeekStreamParams>): DeepSeekStreamParams {
  return {
    model: 'deepseek-v4-pro',
    messages: testMessages,
    apiKey: testApiKey,
    ...overrides
  }
}

/**
 * Collect all yielded chunks from an async iterable into an array.
 */
async function collectChunks(
  adapter: ReturnType<typeof createDeepSeekStreamAdapter>,
  params: DeepSeekStreamParams
): Promise<DeepSeekStreamChunk[]> {
  const chunks: DeepSeekStreamChunk[] = []
  for await (const chunk of adapter.streamChat(params)) {
    chunks.push(chunk)
  }
  return chunks
}

// ---------------------------------------------------------------
// Request verification
// ---------------------------------------------------------------

describe('DeepSeekStreamAdapter — request construction', () => {
  it('POSTs to the correct default endpoint', async () => {
    const { fetchFn, calls } = mockFetch(200, [
      sseLines([sseData({ choices: [{ delta: { content: 'Hi' } }] }), 'data: [DONE]'])
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    await collectChunks(adapter, streamParams())

    expect(calls).toHaveLength(1)
    expect(calls[0].input).toBe('https://api.deepseek.com/chat/completions')
  })

  it('sets the Authorization Bearer header with the apiKey', async () => {
    const { fetchFn, calls } = mockFetch(200, [
      sseLines([sseData({ choices: [{ delta: { content: 'Hi' } }] }), 'data: [DONE]'])
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    await collectChunks(adapter, streamParams())

    const headers = calls[0].init?.headers as Record<string, string> | undefined
    expect(headers).toBeDefined()
    expect(headers!['Authorization']).toBe(`Bearer ${testApiKey}`)
  })

  it('sets Content-Type to application/json', async () => {
    const { fetchFn, calls } = mockFetch(200, [
      sseLines([sseData({ choices: [{ delta: { content: 'Hi' } }] }), 'data: [DONE]'])
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    await collectChunks(adapter, streamParams())

    const headers = calls[0].init?.headers as Record<string, string> | undefined
    expect(headers!['Content-Type']).toBe('application/json')
  })

  it('sends model, messages, stream:true, and stream_options in the JSON body', async () => {
    const { fetchFn, calls } = mockFetch(200, [
      sseLines([sseData({ choices: [{ delta: { content: 'Hi' } }] }), 'data: [DONE]'])
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    await collectChunks(adapter, streamParams({ model: 'deepseek-v4-flash' }))

    const body = JSON.parse(calls[0].init!.body as string) as Record<string, unknown>
    expect(body.model).toBe('deepseek-v4-flash')
    expect(body.messages).toEqual(testMessages)
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('adds thinking.enabled to the body when params.thinking is true', async () => {
    const { fetchFn, calls } = mockFetch(200, [
      sseLines([sseData({ choices: [{ delta: { content: 'Hi' } }] }), 'data: [DONE]'])
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    await collectChunks(adapter, streamParams({ thinking: true }))

    const body = JSON.parse(calls[0].init!.body as string) as Record<string, unknown>
    expect(body.thinking).toEqual({ type: 'enabled' })
  })

  it('omits thinking from the body when params.thinking is false/undefined', async () => {
    const { fetchFn, calls } = mockFetch(200, [
      sseLines([sseData({ choices: [{ delta: { content: 'Hi' } }] }), 'data: [DONE]'])
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    await collectChunks(adapter, streamParams())

    const body = JSON.parse(calls[0].init!.body as string) as Record<string, unknown>
    expect(body.thinking).toBeUndefined()
  })

  it('passes params.signal to fetch when provided', async () => {
    const { fetchFn, calls } = mockFetch(200, [
      sseLines([sseData({ choices: [{ delta: { content: 'Hi' } }] }), 'data: [DONE]'])
    ])

    const controller = new AbortController()
    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    await collectChunks(adapter, streamParams({ signal: controller.signal }))

    expect(calls[0].init!.signal).toBe(controller.signal)
  })

  it('uses the custom endpoint when provided via options', async () => {
    const { fetchFn, calls } = mockFetch(200, [
      sseLines([sseData({ choices: [{ delta: { content: 'Hi' } }] }), 'data: [DONE]'])
    ])

    const adapter = createDeepSeekStreamAdapter({
      fetchImpl: fetchFn,
      endpoint: 'https://custom-proxy.example.com/v1/chat/completions'
    })
    await collectChunks(adapter, streamParams())

    expect(calls[0].input).toBe('https://custom-proxy.example.com/v1/chat/completions')
  })

  it('uses POST method', async () => {
    const { fetchFn, calls } = mockFetch(200, [
      sseLines([sseData({ choices: [{ delta: { content: 'Hi' } }] }), 'data: [DONE]'])
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    await collectChunks(adapter, streamParams())

    expect(calls[0].init!.method).toBe('POST')
  })

  it('keeps a per-request endpoint that already ends with /chat/completions', async () => {
    const { fetchFn, calls } = mockFetch(200, ['data: [DONE]\n\n'])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    await collectChunks(
      adapter,
      streamParams({ _endpoint: 'https://proxy.example.com/v1/chat/completions' })
    )

    expect(calls[0].input).toBe('https://proxy.example.com/v1/chat/completions')
  })
})

// ---------------------------------------------------------------
// Normal SSE parsing
// ---------------------------------------------------------------

describe('DeepSeekStreamAdapter — normal SSE parsing', () => {
  it('yields a DeepSeekStreamChunk for each SSE data line', async () => {
    const contentChunks = [
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ', ' } }] },
      { choices: [{ delta: { content: 'world' } }] },
      { choices: [{ delta: { content: '!' } }] },
      { choices: [{ finish_reason: 'stop' }] }
    ]

    const sseContent = sseLines([
      ...contentChunks.map((c) => sseData(c as Record<string, unknown>)),
      'data: [DONE]'
    ])

    const { fetchFn } = mockFetch(200, [sseContent])
    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    expect(chunks).toHaveLength(5)
    expect(chunks[0].choices?.[0]?.delta?.content).toBe('Hello')
    expect(chunks[1].choices?.[0]?.delta?.content).toBe(', ')
    expect(chunks[2].choices?.[0]?.delta?.content).toBe('world')
    expect(chunks[3].choices?.[0]?.delta?.content).toBe('!')
    expect(chunks[4].choices?.[0]?.finish_reason).toBe('stop')
  })

  it('yields chunks with usage data', async () => {
    const { fetchFn } = mockFetch(200, [
      sseLines([
        sseData({ choices: [{ delta: { content: 'Ok' } }] }),
        sseData({ choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } }),
        'data: [DONE]'
      ])
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    const usageChunk = chunks.find((c) => c.usage)
    expect(usageChunk).toBeDefined()
    expect(usageChunk!.usage!.prompt_tokens).toBe(42)
    expect(usageChunk!.usage!.completion_tokens).toBe(7)
    expect(usageChunk!.usage!.total_tokens).toBe(49)
  })

  it('terminates when [DONE] is received without yielding it', async () => {
    const { fetchFn } = mockFetch(200, [
      sseLines([
        sseData({ choices: [{ delta: { content: 'x' } }] }),
        'data: [DONE]'
      ])
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    expect(chunks).toHaveLength(1)
    expect(chunks[0].choices?.[0]?.delta?.content).toBe('x')
  })
})

// ---------------------------------------------------------------
// Multiple SSE events in a single buffer read
// ---------------------------------------------------------------

describe('DeepSeekStreamAdapter — multiple events in one chunk', () => {
  it('parses multiple data lines delivered in a single read', async () => {
    // All SSE events in one network chunk
    const payload = sseLines([
      sseData({ choices: [{ delta: { content: 'A' } }] }),
      sseData({ choices: [{ delta: { content: 'B' } }] }),
      sseData({ choices: [{ delta: { content: 'C' } }] }),
      'data: [DONE]'
    ])

    const { fetchFn } = mockFetch(200, [payload])
    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    expect(chunks).toHaveLength(3)
    expect(chunks[0].choices?.[0]?.delta?.content).toBe('A')
    expect(chunks[1].choices?.[0]?.delta?.content).toBe('B')
    expect(chunks[2].choices?.[0]?.delta?.content).toBe('C')
  })
})

// ---------------------------------------------------------------
// Partial events split across buffer reads
// ---------------------------------------------------------------

describe('DeepSeekStreamAdapter — partial events across reads', () => {
  it('reassembles a data line split across multiple reads', async () => {
    // First read: partial line
    const part1 = 'data: {"choices":[{"delta":{"content":"He'
    // Second read: rest of line + DONE
    const part2 = 'llo"}}]}\n\ndata: [DONE]\n\n'

    const { fetchFn } = mockFetch(200, [part1, part2])
    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    expect(chunks).toHaveLength(1)
    expect(chunks[0].choices?.[0]?.delta?.content).toBe('Hello')
  })

  it('reassembles when split mid-keyword', async () => {
    // Split right in the middle of "data:"
    const part1 = 'da'
    const part2 = 'ta: {"choices":[{"delta":{"content":"Mid"}}]}\n\ndata: [DONE]\n\n'

    const { fetchFn } = mockFetch(200, [part1, part2])
    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    expect(chunks).toHaveLength(1)
    expect(chunks[0].choices?.[0]?.delta?.content).toBe('Mid')
  })

  it('reassembles when DONE sentinel is split across reads', async () => {
    const part1 = 'data: {"choices":[{"delta":{"content":"X"}}]}\n\ndata: [DO'
    const part2 = 'NE]\n\n'

    const { fetchFn } = mockFetch(200, [part1, part2])
    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    expect(chunks).toHaveLength(1)
    expect(chunks[0].choices?.[0]?.delta?.content).toBe('X')
  })
})

// ---------------------------------------------------------------
// Usage chunk with empty choices
// ---------------------------------------------------------------

describe('DeepSeekStreamAdapter — usage chunk', () => {
  it('yields a chunk with choices:[] and usage when include_usage is true', async () => {
    const { fetchFn } = mockFetch(200, [
      sseLines([
        sseData({ choices: [{ delta: { content: 'Tokens' } }] }),
        sseData({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }),
        sseData({ choices: [{ finish_reason: 'stop' }] }),
        'data: [DONE]'
      ])
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    // Should have all 3 chunks including the usage-only one
    expect(chunks).toHaveLength(3)

    const usageChunk = chunks.find((c) => c.usage !== undefined)
    expect(usageChunk).toBeDefined()
    expect(usageChunk!.choices).toEqual([])
    expect(usageChunk!.usage!.prompt_tokens).toBe(100)
    expect(usageChunk!.usage!.completion_tokens).toBe(50)
    expect(usageChunk!.usage!.total_tokens).toBe(150)
  })
})

// ---------------------------------------------------------------
// Non-2xx error mapping
// ---------------------------------------------------------------

describe('DeepSeekStreamAdapter — non-2xx error mapping', () => {
  it('throws AppError with code UNAUTHORIZED for HTTP 401', async () => {
    const { fetchFn } = mockFetch(401)

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    await expect(collectChunks(adapter, streamParams())).rejects.toThrow(AppError)
    await expect(collectChunks(adapter, streamParams())).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      httpStatus: 401,
      retryable: false
    })
  })

  it('throws AppError with code RATE_LIMITED for HTTP 429', async () => {
    const { fetchFn } = mockFetch(429)

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    await expect(collectChunks(adapter, streamParams())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      httpStatus: 429,
      retryable: true
    })
  })

  it('throws AppError with code SERVER_ERROR for HTTP 500', async () => {
    const { fetchFn } = mockFetch(500)

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    await expect(collectChunks(adapter, streamParams())).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      httpStatus: 500,
      retryable: true
    })
  })

  it('throws AppError with code SERVICE_UNAVAILABLE for HTTP 503', async () => {
    const { fetchFn } = mockFetch(503)

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    await expect(collectChunks(adapter, streamParams())).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      httpStatus: 503,
      retryable: true
    })
  })

  it('throws AppError with code INVALID_REQUEST for HTTP 400', async () => {
    const { fetchFn } = mockFetch(400)

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    await expect(collectChunks(adapter, streamParams())).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      httpStatus: 400
    })
  })

  it('throws AppError with code INSUFFICIENT_BALANCE for HTTP 402', async () => {
    const { fetchFn } = mockFetch(402)

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    await expect(collectChunks(adapter, streamParams())).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
      httpStatus: 402
    })
  })

  it('throws AppError with code UNKNOWN_ERROR for unlisted status', async () => {
    const { fetchFn } = mockFetch(418)

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    await expect(collectChunks(adapter, streamParams())).rejects.toMatchObject({
      code: 'UNKNOWN_ERROR',
      httpStatus: 418
    })
  })

  it('does not include the API key in the error message', async () => {
    const { fetchFn } = mockFetch(401)

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    await expect(collectChunks(adapter, streamParams())).rejects.toSatisfy((err: Error) => {
      return !err.message.includes(testApiKey)
    })
  })
})

// ---------------------------------------------------------------
// Abort signal
// ---------------------------------------------------------------

describe('DeepSeekStreamAdapter — abort signal', () => {
  it('propagates an aborted signal to fetch and throws AbortError', async () => {
    const controller = new AbortController()
    controller.abort()

    // fetch should detect the aborted signal and throw
    const fetchFn = (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      return Promise.reject(new DOMException('The operation was aborted', 'AbortError'))
    }

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn as unknown as typeof fetch })

    await expect(
      collectChunks(adapter, streamParams({ signal: controller.signal }))
    ).rejects.toThrow('The operation was aborted')
  })
})

// ---------------------------------------------------------------
// Malformed JSON sanitization
// ---------------------------------------------------------------

describe('DeepSeekStreamAdapter — malformed JSON', () => {
  it('skips unparseable data lines and keeps streaming the rest', async () => {
    const { fetchFn } = mockFetch(200, [
      'data: {"choices":[{"delta":{"content":"good"}}]}\n\n',
      'data: {this is not json}\n\n',
      'data: {"choices":[{"delta":{"content":"still-good"}}]}\n\n',
      'data: [DONE]\n\n'
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    const tokens = chunks
      .map((c) => c.choices?.[0]?.delta?.content)
      .filter((t): t is string => Boolean(t))
    expect(tokens).toEqual(['good', 'still-good'])
  })

  it('does not leak malformed line contents or the API key', async () => {
    const { fetchFn } = mockFetch(200, [
      'data: definitely-not-json!!!!\n\n',
      'data: [DONE]\n\n'
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    // No chunk is emitted for the bad line — nothing to leak.
    expect(chunks).toHaveLength(0)
    expect(JSON.stringify(chunks)).not.toContain('definitely-not-json')
    expect(JSON.stringify(chunks)).not.toContain(testApiKey)
  })

  it('aborts with STREAM_IDLE_TIMEOUT when the provider goes silent', async () => {
    // A stream that emits one event and then never closes: the idle guard
    // must abort instead of hanging until the session cap.
    const encoder = new TextEncoder()
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
        )
        // Never closes — simulates a stalled connection.
      }
    })
    const fetchFn = (() => Promise.resolve(new Response(stalled, { status: 200 }))) as unknown as typeof fetch

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn, idleTimeoutMs: 50 })

    await expect(collectChunks(adapter, streamParams())).rejects.toSatisfy((err: Error) => {
      return err instanceof AppError && err.code === 'STREAM_IDLE_TIMEOUT'
    })
  })

  it('surfaces a non-timeout read failure without cancelling the reader', async () => {
    const encoder = new TextEncoder()
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
        )
        controller.error(new Error('socket reset'))
      }
    })
    const fetchFn = (() =>
      Promise.resolve(new Response(broken, { status: 200 }))) as unknown as typeof fetch

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn, idleTimeoutMs: 50 })

    await expect(collectChunks(adapter, streamParams())).rejects.toThrow('socket reset')
  })

  it('swallows a rejecting reader.cancel when the idle timeout aborts', async () => {
    const encoder = new TextEncoder()
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
        )
        // Never closes — simulates a stalled connection.
      },
      cancel() {
        return Promise.reject(new Error('cancel failed'))
      }
    })
    const fetchFn = (() =>
      Promise.resolve(new Response(stalled, { status: 200 }))) as unknown as typeof fetch

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn, idleTimeoutMs: 30 })

    await expect(collectChunks(adapter, streamParams())).rejects.toSatisfy((err: Error) => {
      return err instanceof AppError && err.code === 'STREAM_IDLE_TIMEOUT'
    })
  })
})

// ---------------------------------------------------------------
// Edge cases: empty lines, comments, null body
// ---------------------------------------------------------------

describe('DeepSeekStreamAdapter — edge cases', () => {
  it('skips empty lines between SSE events', async () => {
    // Extra blank lines should be ignored
    const { fetchFn } = mockFetch(200, [
      '\n\n\n' +
      sseData({ choices: [{ delta: { content: 'A' } }] }) + '\n\n' +
      '\n\n\n' +
      sseData({ choices: [{ delta: { content: 'B' } }] }) + '\n\n' +
      'data: [DONE]\n\n'
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    expect(chunks).toHaveLength(2)
    expect(chunks[0].choices?.[0]?.delta?.content).toBe('A')
    expect(chunks[1].choices?.[0]?.delta?.content).toBe('B')
  })

  it('skips SSE comment lines (starting with colon)', async () => {
    const { fetchFn } = mockFetch(200, [
      ': this is a comment\n' +
      sseData({ choices: [{ delta: { content: 'val' } }] }) + '\n\n' +
      ': keepalive\n\n' +
      'data: [DONE]\n\n'
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    expect(chunks).toHaveLength(1)
    expect(chunks[0].choices?.[0]?.delta?.content).toBe('val')
  })

  it('throws when response body is null', async () => {
    const { fetchFn } = mockFetchNullBody()

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    await expect(collectChunks(adapter, streamParams())).rejects.toThrow()
  })

  it('yields an empty array when stream contains only [DONE]', async () => {
    const { fetchFn } = mockFetch(200, ['data: [DONE]\n\n'])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    expect(chunks).toHaveLength(0)
  })

  it('ignores non-data SSE fields such as event lines', async () => {
    const { fetchFn } = mockFetch(200, [
      'event: ping\n' +
        sseData({ choices: [{ delta: { content: 'kept' } }] }) +
        '\n\n' +
        'id: 42\n\n' +
        'data: [DONE]\n\n'
    ])

    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })
    const chunks = await collectChunks(adapter, streamParams())

    expect(chunks).toHaveLength(1)
    expect(chunks[0].choices?.[0]?.delta?.content).toBe('kept')
  })
})

// ---------------------------------------------------------------
// Endpoint validation
// ---------------------------------------------------------------

describe('DeepSeekStreamAdapter — endpoint validation', () => {
  it('throws when endpoint uses http:// scheme', () => {
    expect(() =>
      createDeepSeekStreamAdapter({
        endpoint: 'http://api.deepseek.com/chat/completions'
      })
    ).toThrow('Endpoint must use HTTPS')
  })

  it('throws when endpoint uses http:// with a non-standard port', () => {
    expect(() =>
      createDeepSeekStreamAdapter({
        endpoint: 'http://localhost:8080/v1/chat/completions'
      })
    ).toThrow('Endpoint must use HTTPS')
  })

  it('throws before fetch is called (validation is at factory time)', () => {
    let fetchWasCalled = false
    const fetchFn = (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      fetchWasCalled = true
      return Promise.resolve(new Response())
    }

    expect(() =>
      createDeepSeekStreamAdapter({
        endpoint: 'http://leaky-proxy.example.com/v1',
        fetchImpl: fetchFn as unknown as typeof fetch
      })
    ).toThrow('Endpoint must use HTTPS')

    expect(fetchWasCalled).toBe(false)
  })

  it('error message does not contain the http endpoint URL', () => {
    let errorMessage = ''
    try {
      createDeepSeekStreamAdapter({
        endpoint: 'http://my-sensitive-endpoint.internal/v1'
      })
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
    }

    expect(errorMessage).not.toContain('http://')
    expect(errorMessage).not.toContain('my-sensitive')
  })

  it('allows default endpoint (https://api.deepseek.com/...)', () => {
    expect(() => createDeepSeekStreamAdapter()).not.toThrow()
  })

  it('allows custom https:// endpoint', () => {
    expect(() =>
      createDeepSeekStreamAdapter({
        endpoint: 'https://custom-proxy.example.com/v1/chat/completions'
      })
    ).not.toThrow()
  })

  it('throws when per-request _endpoint override uses http://', async () => {
    const { fetchFn, calls } = mockFetch(200, ['data: [DONE]\n\n'])
    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    await expect(
      collectChunks(adapter, streamParams({ _endpoint: 'http://insecure.example.com/v1' }))
    ).rejects.toThrow('Endpoint must use HTTPS')

    // The insecure request must never hit the network
    expect(calls).toHaveLength(0)
  })
})

describe('DeepSeekStreamAdapter — retries, flush and idle timeout', () => {
  it('retries a transient network failure and then streams', async () => {
    let attempts = 0
    const encoder = new TextEncoder()
    const fetchFn = (async () => {
      attempts++
      if (attempts === 1) throw new TypeError('fetch failed')
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) + '\n\n'
            )
          )
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }
      })
      return new Response(stream, { status: 200 })
    }) as unknown as typeof fetch
    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    const chunks = await collectChunks(adapter, streamParams())

    expect(attempts).toBe(2)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].choices?.[0]?.delta?.content).toBe('hi')
  }, 15_000)

  it('does not retry when the abort signal is already triggered', async () => {
    let attempts = 0
    const controller = new AbortController()
    const fetchFn = (async () => {
      attempts++
      // Abort mid-fetch: the adapter must rethrow the original error.
      controller.abort()
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    await expect(
      collectChunks(adapter, streamParams({ signal: controller.signal }))
    ).rejects.toThrow('fetch failed')
    expect(attempts).toBe(1)
  })

  it('gives up after the retry budget is exhausted', async () => {
    let attempts = 0
    const fetchFn = (async () => {
      attempts++
      throw new TypeError('always failing')
    }) as unknown as typeof fetch
    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

    await expect(collectChunks(adapter, streamParams())).rejects.toThrow('always failing')
    expect(attempts).toBe(3)
  }, 15_000)

  it('flushes a malformed trailing line at end-of-stream and warns once', async () => {
    const warnings: unknown[][] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      warnings.push(args as unknown[])
    })
    try {
      // The final line has no trailing blank line, so it only surfaces in the
      // end-of-stream flush — after the malformed line in the buffer.
      const { fetchFn } = mockFetch(200, [
        'data: {not-json}\n\n' + sseData({ choices: [{ delta: { content: 'last' } }] })
      ])
      const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

      const chunks = await collectChunks(adapter, streamParams())

      expect(chunks).toHaveLength(1)
      expect(chunks[0].choices?.[0]?.delta?.content).toBe('last')
      expect(warnings.some((w) => String(w[0]).includes('skipped 1 malformed SSE line(s)'))).toBe(
        true
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('warns when only the final flush finds malformed lines', async () => {
    const warnings: unknown[][] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      warnings.push(args as unknown[])
    })
    try {
      // No newline at all: the line only becomes "complete" in the flush.
      const { fetchFn } = mockFetch(200, ['data: {broken}'])
      const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn })

      const chunks = await collectChunks(adapter, streamParams())

      expect(chunks).toHaveLength(0)
      expect(warnings.some((w) => String(w[0]).includes('skipped 1 malformed SSE line(s)'))).toBe(
        true
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('reads without an idle timeout when the timeout is disabled', async () => {
    const { fetchFn } = mockFetch(
      200,
      [sseLines([sseData({ choices: [{ delta: { content: 'x' } }] }), 'data: [DONE]'])]
    )
    const adapter = createDeepSeekStreamAdapter({ fetchImpl: fetchFn, idleTimeoutMs: 0 })

    const chunks = await collectChunks(adapter, streamParams())

    expect(chunks).toHaveLength(1)
  })
})
