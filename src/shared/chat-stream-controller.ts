/**
 * Chat stream controller — framework-agnostic bridge over a ChatAPI.
 *
 * The controller wraps any ChatAPI implementation with managed state,
 * subscription lifecycle, and cancel semantics.  It is deliberately
 * framework-agnostic so it can be tested without React, DOM, or Electron
 * dependencies.
 *
 * Exported types and the controller function are designed to live in the
 * shared module so they are reachable from both node-side tests
 * (tsconfig.node.json) and the renderer (tsconfig.web.json).
 */

// --------------- types ---------------

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export interface StreamError {
  code: string
  message: string
}

export interface StreamUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatAPI {
  startStream: (messages: ChatMessage[], model?: string, thinking?: boolean) => Promise<string>
  cancelStream: (sessionId: string) => Promise<void>
  onToken: (sessionId: string, callback: (token: string) => void) => () => void
  onThinking: (sessionId: string, callback: (text: string) => void) => () => void
  onError: (sessionId: string, callback: (error: StreamError) => void) => () => void
  onEnd: (sessionId: string, callback: (finishReason: string) => void) => () => void
  onUsage: (sessionId: string, callback: (usage: StreamUsage) => void) => () => void
}

export interface ChatStreamState {
  sessionId: string | null
  isStreaming: boolean
  error: StreamError | null
  assistantContent: string
  reasoningContent: string
  usage: StreamUsage | null
}

export interface CreateChatStreamControllerResult {
  readonly state: ChatStreamState
  send(messages: ChatMessage[], model?: string, thinking?: boolean): Promise<void>
  cancel(): Promise<void>
  /** Promise that resolves when the current stream ends. null if not streaming. */
  readonly streamEnd: Promise<{ content: string; finishReason: string }> | null
}

// --------------- controller ---------------

export function createChatStreamController(
  api: ChatAPI,
  onStateChange?: (state: ChatStreamState) => void
): CreateChatStreamControllerResult {
  const state: ChatStreamState = {
    sessionId: null,
    isStreaming: false,
    error: null,
    assistantContent: '',
    reasoningContent: '',
    usage: null
  }

  /** All active unsubscribe callbacks.  Cleared on every reset. */
  let unsubscribers: Array<() => void> = []

  /** Resolve for the current stream's end promise */
  let streamEndResolve: ((value: { content: string; finishReason: string }) => void) | null = null
  let currentStreamEnd: Promise<{ content: string; finishReason: string }> | null = null

  function notify(): void {
    onStateChange?.({
      sessionId: state.sessionId,
      isStreaming: state.isStreaming,
      error: state.error,
      assistantContent: state.assistantContent,
      reasoningContent: state.reasoningContent,
      usage: state.usage
    })
  }

  function update(partial: Partial<ChatStreamState>): void {
    if ('sessionId' in partial) state.sessionId = partial.sessionId ?? null
    /* v8 ignore next -- @preserve */
    if ('isStreaming' in partial) state.isStreaming = partial.isStreaming ?? false
    if ('error' in partial) state.error = partial.error ?? null
    /* v8 ignore next -- @preserve */
    if ('assistantContent' in partial) state.assistantContent = partial.assistantContent ?? ''
    /* v8 ignore next -- @preserve */
    if ('reasoningContent' in partial) state.reasoningContent = partial.reasoningContent ?? ''
    if ('usage' in partial) state.usage = partial.usage ?? null
    notify()
  }

  function unsubscribeAll(): void {
    for (const unsub of unsubscribers) {
      unsub()
    }
    unsubscribers = []
  }

  function resetState(): void {
    unsubscribeAll()
    update({
      sessionId: null,
      isStreaming: true,
      error: null,
      assistantContent: '',
      reasoningContent: '',
      usage: null
    })
  }

  async function cancel(): Promise<void> {
    if (state.sessionId !== null) {
      try {
        await api.cancelStream(state.sessionId)
      } catch {
        // Best-effort — always clean up local state regardless
      }
    }
    unsubscribeAll()
    update({
      sessionId: null,
      isStreaming: false,
      error: null,
      assistantContent: '',
      reasoningContent: '',
      usage: null
    })
  }

  async function send(
    messages: ChatMessage[],
    model?: string,
    thinking?: boolean
  ): Promise<void> {
    // Cancel any in-flight stream
    if (state.sessionId !== null) {
      try {
        await api.cancelStream(state.sessionId)
      } catch {
        // Best-effort — proceed regardless
      }
      unsubscribeAll()
    }

    resetState()

    let sessionId: string
    try {
      sessionId = await api.startStream(messages, model, thinking)
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown stream start error'
      update({
        sessionId: null,
        isStreaming: false,
        error: { code: 'STREAM_START_FAILED', message }
      })
      return
    }

    update({ sessionId })

    // Create a promise that resolves when the stream ends
    currentStreamEnd = new Promise<{ content: string; finishReason: string }>((resolve) => {
      streamEndResolve = resolve
    })

    // Subscribe to stream events
    const unsubToken = api.onToken(sessionId, (token: string) => {
      update({ assistantContent: state.assistantContent + token })
    })

    const unsubThinking = api.onThinking(sessionId, (text: string) => {
      update({ reasoningContent: state.reasoningContent + text })
    })

    const unsubError = api.onError(sessionId, (err: StreamError) => {
      unsubscribeAll()
      update({ error: err, isStreaming: false })
      // Resolve instead of reject to avoid unhandled rejections
      // when nobody is awaiting streamEnd
      streamEndResolve?.({ content: state.assistantContent, finishReason: `error:${err.code}` })
      streamEndResolve = null
      currentStreamEnd = null
    })

    const unsubEnd = api.onEnd(sessionId, (_finishReason: string) => {
      unsubscribeAll()
      update({ isStreaming: false })
      streamEndResolve?.({ content: state.assistantContent, finishReason: _finishReason })
      streamEndResolve = null
      currentStreamEnd = null
    })

    const unsubUsage = api.onUsage(sessionId, (usage: StreamUsage) => {
      update({ usage })
    })

    unsubscribers = [unsubToken, unsubThinking, unsubError, unsubEnd, unsubUsage]
  }

  return {
    get state() {
      return {
        sessionId: state.sessionId,
        isStreaming: state.isStreaming,
        error: state.error,
        assistantContent: state.assistantContent,
        reasoningContent: state.reasoningContent,
        usage: state.usage
      }
    },
    send,
    cancel,
    get streamEnd() {
      return currentStreamEnd
    }
  }
}
