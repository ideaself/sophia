/**
 * Main-process DeepSeek chat client.
 *
 * Design:
 * - Constructor receives an API key (plaintext) and an injected adapter.
 * - The adapter performs the actual HTTP call; tests inject a mock.
 * - The client only adds: model selection, request validation,
 *   response extraction, and error mapping.
 * - The API key is passed through to the adapter and never exposed
 *   outside this file's constructor.
 */

import type {
  DeepSeekApiAdapter,
  DeepSeekModel,
  DeepSeekChatMessage,
  DeepSeekChatResponse
} from './types'
import { DEEPSEEK_V4_PRO } from './types'
import { AppError, mapDeepSeekError } from './errors'
import { sleepWithAbort } from './sleep'

export class DeepSeekClient {
  private readonly apiKey: string
  private readonly adapter: DeepSeekApiAdapter
  private readonly defaultModel: DeepSeekModel

  /**
   * @param apiKey    Plaintext DeepSeek API key (validated non-empty).
   * @param adapter   Injected HTTP adapter.
   * @param defaultModel  Default model when chat() is called without
   *                      an explicit model.  Defaults to DEEPSEEK_V4_PRO.
   */
  constructor(
    apiKey: string,
    adapter: DeepSeekApiAdapter,
    defaultModel: DeepSeekModel = DEEPSEEK_V4_PRO
  ) {
    if (apiKey.trim().length === 0) {
      throw new AppError(
        'MISSING_API_KEY',
        0,
        'DeepSeek API key is required but was empty'
      )
    }

    this.apiKey = apiKey
    this.adapter = adapter
    this.defaultModel = defaultModel
  }

  /**
   * Send a non-streaming chat request to DeepSeek and return the
   * first assistant choice as a typed response.
   *
   * Retries up to 2 times on transient errors (429, 500, 503) with
   * exponential backoff (1s, 2s). The backoff is abortable: when
   * `options.signal` fires, the wait ends immediately with an AbortError.
   *
   * @param messages  Ordered conversation messages (system/user/assistant).
   * @param options   Optional overrides (model, abort signal).
   */
  async chat(
    messages: DeepSeekChatMessage[],
    options?: { model?: DeepSeekModel; signal?: AbortSignal }
  ): Promise<DeepSeekChatResponse> {
    const model = options?.model ?? this.defaultModel
    const signal = options?.signal
    const maxRetries = 2

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.adapter.chatCompletion({
          model,
          messages,
          apiKey: this.apiKey,
          signal
        })

        if (!result.ok) {
          throw mapDeepSeekError(result.status, result.body)
        }

        return extractChatResponse(result.data)
      } catch (err) {
        if (err instanceof AppError && err.retryable && attempt < maxRetries) {
          const delayMs = 1000 * Math.pow(2, attempt)
          await sleepWithAbort(delayMs, signal)
          continue
        }
        throw err
      }
    }

    // Unreachable: the loop either returns or throws. Kept for exhaustiveness.
    /* v8 ignore next -- @preserve */
    throw new AppError('UNKNOWN_ERROR', 0, 'DeepSeek request failed')
  }
}

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------

function extractChatResponse(data: {
  model?: string
  choices?: Array<{
    message?: { role?: string; content?: string; reasoning_content?: string }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}): DeepSeekChatResponse {
  const choice = data.choices?.[0]

  if (!choice?.message?.content) {
    // A thinking model that exhausts its token budget mid-reasoning returns
    // reasoning_content with empty content. Surface that distinctly so the
    // caller can tell a truncation apart from a truly malformed response.
    const hasReasoning = Boolean(choice?.message?.reasoning_content)
    throw new AppError(
      'EMPTY_RESPONSE',
      0,
      hasReasoning
        ? '模型只输出了思考内容（可能被 max_tokens 截断），未生成回答'
        : 'DeepSeek returned an empty or malformed response'
    )
  }

  return {
    content: choice.message.content,
    model: data.model ?? 'unknown',
    finishReason: choice.finish_reason ?? null,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0
    }
  }
}
