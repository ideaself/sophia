/**
 * Chat stream hook — thin React wrapper over the app-level stream singleton
 * (see chat-stream-store.ts).
 *
 * The framework-agnostic controller logic lives in
 * `src/shared/chat-stream-controller.ts`. This file re-exports the shared
 * types and factory, and keeps `useChatStream()` for consumers that need to
 * subscribe (the classroom uses `useChatStreamTick` + the store directly).
 */

import {
  createChatStreamController,
  type ChatMessage,
  type ChatStreamState,
  type StreamError,
  type StreamUsage,
  type CreateChatStreamControllerResult
} from '../../../shared/chat-stream-controller'
import { getChatStreamController, useChatStreamTick } from './chat-stream-store'

// Re-export for backward compatibility
export { createChatStreamController }
export type {
  ChatMessage,
  ChatStreamState,
  StreamError,
  StreamUsage,
  CreateChatStreamControllerResult
}

export function useChatStream(): CreateChatStreamControllerResult {
  useChatStreamTick()
  return getChatStreamController()
}
