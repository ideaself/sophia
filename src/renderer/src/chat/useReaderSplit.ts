/**
 * In-class textbook reader split: open state + draggable width.
 *
 * Extracted from ClassroomView so the drag/resize bookkeeping (refs,
 * pointer listeners, persisted width) is isolated and testable.
 *
 * The divider sits between the chat column and the reader: dragging left
 * widens the reader, so the width delta is the inverse of the mouse delta.
 * The maximum width follows the viewport (reader max = window − chat min).
 */

import { useCallback, useRef, useState } from 'react'

const WIDTH_STORAGE_KEY = 'sophia.classroomReaderWidth'
const MIN_READER_WIDTH = 280
/** Minimum width reserved for the chat column. */
const MIN_CHAT_WIDTH = 360
const DEFAULT_READER_WIDTH = 480

function loadInitialWidth(): number {
  try {
    const stored = parseInt(localStorage.getItem(WIDTH_STORAGE_KEY) ?? '', 10)
    const maxWidth = Math.max(MIN_READER_WIDTH, window.innerWidth - MIN_CHAT_WIDTH)
    return Number.isFinite(stored)
      ? Math.min(maxWidth, Math.max(MIN_READER_WIDTH, stored))
      : Math.min(DEFAULT_READER_WIDTH, maxWidth)
  } catch {
    return DEFAULT_READER_WIDTH
  }
}

export interface ReaderSplit {
  readerOpen: boolean
  setReaderOpen: React.Dispatch<React.SetStateAction<boolean>>
  readerWidth: number
  handleReaderResizeStart: (e: React.MouseEvent) => void
}

export function useReaderSplit(): ReaderSplit {
  const [readerOpen, setReaderOpen] = useState(false)
  const [readerWidth, setReaderWidth] = useState(loadInitialWidth)
  const dragStart = useRef<{ x: number; w: number } | null>(null)
  const widthRef = useRef(readerWidth)

  const handleReaderResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStart.current = { x: e.clientX, w: widthRef.current }

    const onMove = (ev: MouseEvent): void => {
      const start = dragStart.current
      if (!start) return
      const maxWidth = Math.max(MIN_READER_WIDTH, window.innerWidth - MIN_CHAT_WIDTH)
      const next = Math.min(maxWidth, Math.max(MIN_READER_WIDTH, start.w + (start.x - ev.clientX)))
      widthRef.current = next
      setReaderWidth(next)
    }

    const onUp = (): void => {
      dragStart.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      try {
        localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current))
      } catch {
        // best-effort
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return { readerOpen, setReaderOpen, readerWidth, handleReaderResizeStart }
}
