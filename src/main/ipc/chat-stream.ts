/**
 * IPC handlers for the streaming chat pipeline.
 *
 * The main process manages a map of active StreamChatSession instances.
 * The renderer invokes `chat:stream-start` to create a session and
 * subscribes to events via preload wrappers that internally use
 * `ipcRenderer.on`.
 *
 * Security guarantees:
 * - The API key is read from SecureKeyStore in the main process and
 *   passed directly to the streaming adapter. It is never sent to
 *   the renderer.
 * - The renderer only sees sessionId, token events, error events,
 *   end events, and usage events.
 * - Input validated with Zod: max 200 messages, max 32768 chars per
 *   content, model constrained to known DeepSeek models, system role
 *   restricted to index 0 only.
 */

import { ipcMain, type WebContents } from 'electron'
import { z } from 'zod'
import { StreamChatSession } from '../llm/stream-chat'
import type { DeepSeekStreamParams } from '../llm/stream-types'
import { safeSend } from './safe-send'
import {
  CHAT_STREAM_START,
  CHAT_STREAM_CANCEL,
  CHAT_STREAM_EVENT
} from '../../shared/channel-names'

// ---------------------------------------------------------------
// Known DeepSeek model identifiers (fallback defaults)
// ---------------------------------------------------------------

export const DEEPSEEK_MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash'] as const

// ---------------------------------------------------------------
// Zod schemas for IPC inputs
// ---------------------------------------------------------------

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z
    .string()
    .min(1, 'Message content must not be empty')
    .max(32768, 'Message content exceeds 32768 characters')
})

export const ChatStreamStartInputSchema = z.object({
  messages: z
    .array(ChatMessageSchema)
    .min(1, 'At least one message is required')
    .max(200, 'Maximum 200 messages per request'),
  model: z
    .string()
    .min(1)
    .default('deepseek-v4-pro'),
  thinking: z.boolean().optional()
}).refine(
  (input) => {
    // System role only allowed as the first message (index 0)
    const systemIndex = input.messages.findIndex((m) => m.role === 'system')
    return systemIndex <= 0
  },
  {
    message: 'System role is only allowed as the first message (index 0)'
  }
)

export const ChatStreamCancelInputSchema = z.object({
  sessionId: z.string().min(1)
})

// ---------------------------------------------------------------
// Adapter factory type
// ---------------------------------------------------------------

/**
 * Function that creates a streaming adapter for a given set of params
 * and an API key. Injected to decouple IPC from the real HTTP adapter.
 */
export type StreamAdapterFactory = (
  params: DeepSeekStreamParams
) => AsyncIterable<import('../llm/stream-types').DeepSeekStreamChunk>

/**
 * Function that reads the API key. Returns null if no key is configured.
 * In production this wraps SecureKeyStore.readKey(); in tests it can
 * return a mock key.
 */
export type ApiKeyReader = () => Promise<string | null>

/**
 * Function that reads the active provider config for streaming.
 * Returns model + endpoint, or null if no provider is configured.
 */
export type ActiveProviderReader = () => Promise<{ model: string; baseUrl: string } | null>

// ---------------------------------------------------------------
// Stream event payloads sent to the renderer
// ---------------------------------------------------------------

interface TokenPayload {
  sessionId: string
  token: string
}

interface ThinkingPayload {
  sessionId: string
  text: string
}

interface ErrorPayload {
  sessionId: string
  code: string
  message: string
}

interface EndPayload {
  sessionId: string
  finishReason: string
}

interface UsagePayload {
  sessionId: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// ---------------------------------------------------------------
// Registration
// ---------------------------------------------------------------

/**
 * Register IPC handlers for the streaming chat pipeline.
 *
 * @param getWebContents  Function that returns the current WebContents.
 *                        Typically wraps `mainWindow.webContents`.
 * @param adapterFactory  Creates a streaming adapter from params.
 * @param readApiKey      Reads the API key (never exposed to renderer).
 */
export function registerChatStreamIpc(
  getWebContents: () => WebContents,
  adapterFactory: StreamAdapterFactory,
  readApiKey: ApiKeyReader,
  readActiveProvider?: ActiveProviderReader
): Map<string, StreamChatSession> {
  const sessions = new Map<string, StreamChatSession>()

  // --- chat:stream-start ---
  ipcMain.handle(CHAT_STREAM_START, async (_event, input: unknown) => {
    const parsed = ChatStreamStartInputSchema.parse(input)

    const apiKey = await readApiKey()
    if (apiKey === null) {
      throw new Error('API key not configured')
    }

    // Read model and endpoint from active provider
    let model = parsed.model
    let _endpoint: string | undefined
    if (readActiveProvider) {
      const provider = await readActiveProvider()
      if (provider) {
        model = provider.model
        _endpoint = provider.baseUrl
      }
    }

    const sessionId = generateSessionId()
    const wc = getWebContents()

    const session = new StreamChatSession(
      sessionId,
      {
        messages: parsed.messages,
        model,
        apiKey,
        _endpoint,
        thinking: parsed.thinking ?? false
      },
      { streamChat: (p) => adapterFactory(p) },
      (event) => {
        switch (event.type) {
          case 'token':
            safeSend(wc, CHAT_STREAM_EVENT.token, {
              sessionId,
              token: event.token
            } satisfies TokenPayload)
            break
          case 'thinking':
            safeSend(wc, CHAT_STREAM_EVENT.thinking, {
              sessionId,
              text: event.text
            } satisfies ThinkingPayload)
            break
          case 'error':
            safeSend(wc, CHAT_STREAM_EVENT.error, {
              sessionId,
              code: event.code,
              message: event.message
            } satisfies ErrorPayload)
            break
          case 'end':
            safeSend(wc, CHAT_STREAM_EVENT.end, {
              sessionId,
              finishReason: event.finishReason
            } satisfies EndPayload)
            break
          case 'usage':
            safeSend(wc, CHAT_STREAM_EVENT.usage, {
              sessionId,
              promptTokens: event.promptTokens,
              completionTokens: event.completionTokens,
              totalTokens: event.totalTokens
            } satisfies UsagePayload)
            break
        }
      }
    )

    sessions.set(sessionId, session)

    // Start the stream (fire-and-forget; errors are caught inside Session,
    // but a destroyed window during shutdown can still reject — swallow it
    // so it never becomes an unhandled rejection).
    void session
      .start()
      .catch((err) => {
        console.error('[chat-stream] session error:', err)
      })
      .finally(() => {
        // Clean up after stream completes
        sessions.delete(sessionId)
      })

    return sessionId
  })

  // --- chat:stream-cancel ---
  ipcMain.handle(CHAT_STREAM_CANCEL, async (_event, input: unknown) => {
    const parsed = ChatStreamCancelInputSchema.parse(input)
    const session = sessions.get(parsed.sessionId)
    if (session) {
      session.cancel()
    }
    // If the session doesn't exist, it already completed — nothing to cancel
  })

  return sessions
}

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------

let sessionCounter = 0

function generateSessionId(): string {
  sessionCounter += 1
  return `stream-${Date.now()}-${sessionCounter}`
}
