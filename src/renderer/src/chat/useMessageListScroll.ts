/**
 * Classroom message-list scroll system (extracted from ClassroomView):
 * stick-to-bottom anchoring, virtualization and search-match navigation.
 *
 * Behaviour is intentionally unchanged from the in-component version:
 * - while pinned, the viewport follows the real bottom (`scrollHeight`), not
 *   the virtualizer's estimated total size — long unmeasured replies would
 *   otherwise bounce the viewport above the true bottom;
 * - scrolling up beyond the 48px threshold unpins and stops following;
 * - switching tabs, starting a stream and navigating to a search match each
 *   move the anchor deliberately (reset / pin / unpin).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/** Distance from the real bottom (px) still considered "pinned". */
export const STICK_THRESHOLD_PX = 48

export type MessageVirtualizer = ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>

export interface ScrollRow {
  key: string
}

export interface UseMessageListScrollOptions {
  /** Rendered rows (messages + status rows); only `key` is read for virtualization. */
  rows: readonly ScrollRow[]
  /** Persisted messages of the active tab: appending re-pins while stuck. */
  messages: readonly unknown[]
  /** Live streaming text: growing it re-pins while stuck. */
  streamContent: string
  /** True while a stream runs (any tab): a fresh start re-pins to bottom. */
  streaming: boolean
  /** Active tab index: switching tabs resets the anchor. */
  activeIdx: number
  /** In-conversation search open: closing re-evaluates the anchor. */
  searchOpen: boolean
  /** Message indices matching the query. */
  searchMatches: readonly number[]
  matchIndex: number
}

export interface MessageListScroll {
  scrollRef: RefObject<HTMLDivElement | null>
  stickToBottom: boolean
  setStickToBottom: (value: boolean) => void
  handleScroll: () => void
  virtualizer: MessageVirtualizer
}

export function useMessageListScroll(options: UseMessageListScrollOptions): MessageListScroll {
  const {
    rows,
    messages,
    streamContent,
    streaming,
    activeIdx,
    searchOpen,
    searchMatches,
    matchIndex
  } = options

  const scrollRef = useRef<HTMLDivElement>(null)
  const [stickToBottom, setStickToBottom] = useState(true)

  /** null when the container is not mounted (early return without a companion). */
  const measureNearBottom = useCallback((): boolean | null => {
    const el = scrollRef.current
    if (!el) return null
    return el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX
  }, [])

  const handleScroll = useCallback(() => {
    const near = measureNearBottom()
    if (near !== null) setStickToBottom(near)
  }, [measureNearBottom])

  // When the search closes, re-evaluate the scroll anchor based on the actual
  // position (match navigation may have scrolled away from the bottom).
  useEffect(() => {
    if (searchOpen) return
    const near = measureNearBottom()
    if (near !== null) setStickToBottom(near)
  }, [searchOpen, measureNearBottom])

  // Tab switching resets the anchor: the newly shown tab starts following.
  useEffect(() => {
    setStickToBottom(true)
  }, [activeIdx])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 200,
    overscan: 10,
    getItemKey: (index) => rows[index]?.key ?? index
  })

  // Current virtualized total height (estimated + measured). Row measurement
  // updates change it, which re-pins a stuck viewport when content above it
  // changed size.
  const totalSize = virtualizer.getTotalSize()

  // Auto-scroll to the newest message while pinned to the bottom.
  useEffect(() => {
    if (!stickToBottom || rows.length === 0) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, streamContent, stickToBottom, totalSize, rows.length])

  // Scroll the current search match into view (and unpin).
  useEffect(() => {
    if (searchMatches.length === 0) return
    const target = searchMatches[Math.min(matchIndex, searchMatches.length - 1)]
    setStickToBottom(false)
    virtualizer.scrollToIndex(target, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在匹配项变化时跳转；virtualizer 实例随 rows 变化，加入会打断贴底滚动
  }, [matchIndex, searchMatches])

  // Pin to the bottom when a new stream starts.
  const prevStreamingRef = useRef(false)
  useEffect(() => {
    if (streaming && !prevStreamingRef.current) {
      setStickToBottom(true)
    }
    prevStreamingRef.current = streaming
  }, [streaming])

  return { scrollRef, stickToBottom, setStickToBottom, handleScroll, virtualizer }
}
