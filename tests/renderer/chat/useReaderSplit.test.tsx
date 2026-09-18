// @vitest-environment jsdom
/**
 * useReaderSplit — initial width from storage/viewport and the drag-resize
 * bookkeeping (inverse delta, min/max clamping, persisted width).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { MouseEvent as ReactMouseEvent } from 'react'

import { useReaderSplit } from '../../../src/renderer/src/chat/useReaderSplit'

const KEY = 'sophia.classroomReaderWidth'

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

beforeEach(() => {
  localStorage.clear()
  setViewportWidth(1200)
})

afterEach(cleanup)

function startDrag(hook: { current: ReturnType<typeof useReaderSplit> }, clientX: number): void {
  act(() => {
    hook.current.handleReaderResizeStart({
      preventDefault: vi.fn(),
      clientX
    } as unknown as ReactMouseEvent)
  })
}

describe('useReaderSplit', () => {
  it('defaults to 480px and restores a stored width', () => {
    const first = renderHook(() => useReaderSplit())
    expect(first.result.current.readerWidth).toBe(480)
    expect(first.result.current.readerOpen).toBe(false)

    localStorage.setItem(KEY, '600')
    const restored = renderHook(() => useReaderSplit())
    expect(restored.result.current.readerWidth).toBe(600)
  })

  it('clamps a stored width to the viewport maximum', () => {
    setViewportWidth(700) // max = 700 - 360 = 340
    localStorage.setItem(KEY, '900')

    const hook = renderHook(() => useReaderSplit())
    expect(hook.result.current.readerWidth).toBe(340)
  })

  it('falls back to the default when storage holds garbage', () => {
    localStorage.setItem(KEY, 'not-a-number')
    const hook = renderHook(() => useReaderSplit())
    expect(hook.result.current.readerWidth).toBe(480)
  })

  it('drags to widen the reader, clamps and persists the width', () => {
    const hook = renderHook(() => useReaderSplit())

    startDrag(hook.result, 800)
    // Dragging left by 100px widens the reader by 100px.
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 700 }))
    })
    expect(hook.result.current.readerWidth).toBe(580)

    // Dragging far right clamps at the 280px minimum.
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000 }))
    })
    expect(hook.result.current.readerWidth).toBe(280)

    // Dragging far left clamps at the viewport maximum (1200 - 360).
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: -5000 }))
    })
    expect(hook.result.current.readerWidth).toBe(840)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(localStorage.getItem(KEY)).toBe('840')

    // Further moves after mouseup are ignored.
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 }))
    })
    expect(hook.result.current.readerWidth).toBe(840)
  })

  it('opens and closes through the setter', () => {
    const hook = renderHook(() => useReaderSplit())
    act(() => hook.result.current.setReaderOpen(true))
    expect(hook.result.current.readerOpen).toBe(true)
    act(() => hook.result.current.setReaderOpen(false))
    expect(hook.result.current.readerOpen).toBe(false)
  })
})

describe('useReaderSplit — storage failures', () => {
  it('falls back to the default width when storage is unavailable', () => {
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage denied')
      })
    try {
      const hook = renderHook(() => useReaderSplit())
      expect(hook.result.current.readerWidth).toBe(480)
    } finally {
      getItem.mockRestore()
    }
  })
})
