/**
 * Chat stream hook — thin React wrapper over the shared controller.
 *
 * The framework-agnostic controller logic lives in
 * `src/shared/chat-stream-controller.ts`.  This file only provides the
 * React binding (`useChatStream`) and re-exports the shared types and
 * factory for backward compatibility.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createChatStreamController,
  type ChatMessage,
  type ChatStreamState,
  type StreamError,
  type StreamUsage,
  type CreateChatStreamControllerResult
} from '../../../shared/chat-stream-controller'
import { createFrameCoalescer, type FrameCoalescer } from '../../../shared/frame-coalescer'

// Re-export for backward compatibility
export { createChatStreamController }
export type {
  ChatMessage,
  ChatStreamState,
  StreamError,
  StreamUsage,
  CreateChatStreamControllerResult
}

// --------------- React hook ---------------

export function useChatStream(): CreateChatStreamControllerResult {
  const [, setTick] = useState(0)
  const controllerRef = useRef<CreateChatStreamControllerResult | null>(null)
  const coalescerRef = useRef<FrameCoalescer | null>(null)

  if (controllerRef.current === null) {
    const api = window.sophia.chat
    coalescerRef.current = createFrameCoalescer(() => setTick((n) => n + 1))
    controllerRef.current = createChatStreamController(api, () => {
      coalescerRef.current?.schedule()
    })
  }

  useEffect(() => {
    return () => coalescerRef.current?.dispose()
  }, [])

  const send = useCallback(
    (messages: ChatMessage[], model?: string, thinking?: boolean) =>
      controllerRef.current!.send(messages, model, thinking),
    []
  )

  const cancel = useCallback(() => controllerRef.current!.cancel(), [])

  return useMemo(() => ({
    get state() {
      return controllerRef.current!.state
    },
    send,
    cancel,
    get streamEnd() {
      return controllerRef.current!.streamEnd
    }
  }), [send, cancel])
}
