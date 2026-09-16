/**
 * App-level chat-stream singleton.
 *
 * The controller must outlive view switches — a stream keeps running while
 * the user opens the history or settings — so it is created outside React and
 * the shell only holds the (stable) reference: `App` never re-renders per
 * token. The classroom subscribes through `useChatStreamTick()` and gets one
 * frame-coalesced re-render per animation frame instead.
 */

import { useEffect, useState } from 'react'
import {
  createChatStreamController,
  type CreateChatStreamControllerResult
} from '../../../shared/chat-stream-controller'
import { createFrameCoalescer, type FrameCoalescer } from '../../../shared/frame-coalescer'

let controller: CreateChatStreamControllerResult | null = null
let coalescer: FrameCoalescer | null = null
const listeners = new Set<() => void>()

function notify(): void {
  // Nobody is listening (e.g. outside the classroom): no renders to schedule.
  if (listeners.size === 0) return
  if (coalescer === null) {
    coalescer = createFrameCoalescer(() => {
      for (const listener of [...listeners]) listener()
    })
  }
  coalescer.schedule()
}

/** Stable controller instance; created on first use (needs window.sophia.chat). */
export function getChatStreamController(): CreateChatStreamControllerResult {
  if (controller === null) {
    controller = createChatStreamController(window.sophia.chat, notify)
  }
  return controller
}

export function subscribeChatStream(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Subscribe the calling component to stream-state changes (one re-render per frame). */
export function useChatStreamTick(): void {
  const [, setTick] = useState(0)
  useEffect(() => subscribeChatStream(() => setTick((n) => n + 1)), [])
}

/** Test seam: drop the singleton + listeners (module state is per test file). */
export function resetChatStreamStore(): void {
  coalescer?.dispose()
  coalescer = null
  controller = null
  listeners.clear()
}
