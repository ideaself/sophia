/**
 * DeepSeek HTTP adapter — non-streaming chat completion via fetch.
 *
 * Implements {@link DeepSeekApiAdapter} by POSTing to the raw DeepSeek
 * REST endpoint.  The adapter is pure infrastructure: it never modifies
 * the request payload or interprets error bodies — that responsibility
 * belongs to {@link DeepSeekClient} and {@link mapDeepSeekError}.
 *
 * The adapter intentionally does NOT log, persist, or return the API key
 * in any form.
 */

import type {
  DeepSeekApiAdapter,
  DeepSeekApiParams,
  DeepSeekApiResult
} from './types'
import { assertHttpsEndpoint } from './endpoint'

/** Default request timeout — a hung endpoint must not block generation forever. */
const DEFAULT_TIMEOUT_MS = 60_000

// ---------------------------------------------------------------
// Options
// ---------------------------------------------------------------

export interface DeepSeekHttpAdapterOptions {
  /**
   * Override the default endpoint.
   *
   * @default "https://api.deepseek.com/chat/completions"
   */
  endpoint?: string

  /**
   * Inject a custom fetch implementation (useful in tests).
   *
   * @default globalThis.fetch
   */
  fetchImpl?: typeof fetch
}

// ---------------------------------------------------------------
// Factory
// ---------------------------------------------------------------

/**
 * Create a non-streaming DeepSeek HTTP adapter.
 *
 * The returned adapter conforms to {@link DeepSeekApiAdapter} so it can
 * be injected directly into {@link DeepSeekClient}.  All network details
 * — endpoint, headers, JSON serialisation — are encapsulated here.
 */
export function createDeepSeekHttpAdapter(
  options: DeepSeekHttpAdapterOptions = {}
): DeepSeekApiAdapter {
  const endpoint =
    options.endpoint ?? 'https://api.deepseek.com/chat/completions'

  assertHttpsEndpoint(endpoint)

  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  return {
    async chatCompletion(
      params: DeepSeekApiParams
    ): Promise<DeepSeekApiResult> {
      try {
        // Caller-owned signal (quit/cancel) combined with the request
        // timeout — either one aborts the fetch.
        const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
        const signal = params.signal
          ? AbortSignal.any([timeoutSignal, params.signal])
          : timeoutSignal

        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.apiKey}`
          },
          body: JSON.stringify({
            model: params.model,
            messages: params.messages,
            stream: false
          }),
          signal
        })

        if (response.ok) {
          const data = await response.json()
          return { ok: true, data }
        }

        let body: Record<string, unknown> | undefined
        try {
          body = (await response.json()) as Record<string, unknown>
        } catch {
          // Response body is not valid JSON — leave body undefined so
          // mapDeepSeekError falls back to its status-based default message.
        }

        return { ok: false, status: response.status, body }
      } catch (err) {
        // Caller-initiated cancellation propagates so upstream can react to
        // it instead of seeing a generic network failure. Internal timeouts
        // (no caller signal) keep the existing non-retryable mapping.
        /* v8 ignore next -- @preserve */
        if (params.signal?.aborted) throw err
        // Never attach the raw Error object — it could contain the request
        // URL which includes the API key in the Authorization header.
        return { ok: false, status: 0 }
      }
    }
  }
}
