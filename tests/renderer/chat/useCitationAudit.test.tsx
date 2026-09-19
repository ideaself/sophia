// @vitest-environment jsdom
/**
 * useCitationAudit — loads the bound textbook and flags stored assistant
 * messages whose citation blocks cannot be found in it.
 *
 * Silent by design: no textbook id, empty content or a failed read must never
 * produce a flag (false positives are worse than a missed hint).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { useCitationAudit } from '../../../src/renderer/src/chat/useCitationAudit'

const data = { getTextbook: vi.fn() }

const MARKER = '【教材出处 · 《物理讲义》 · 第一章】'
const FAKE = {
  id: 'a1',
  role: 'assistant' as const,
  content: `> ${MARKER}\n> 这段引文在教材里根本不存在`
}
const REAL = {
  id: 'a2',
  role: 'assistant' as const,
  content: `> ${MARKER}\n> 熵是状态函数`
}
const BOOK = '# 第一章\n熵是状态函数，用来描述系统的混乱程度。'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  data.getTextbook.mockReset()
  Object.defineProperty(window, 'sophia', { configurable: true, value: { data } })
})

afterEach(cleanup)

describe('useCitationAudit', () => {
  it('stays empty without a bound textbook (no fetch)', () => {
    const { result } = renderHook(() => useCitationAudit(null, [FAKE]))
    expect(result.current.size).toBe(0)
    expect(data.getTextbook).not.toHaveBeenCalled()
  })

  it('flags only citations missing from the textbook', async () => {
    data.getTextbook.mockResolvedValue({ content: BOOK })
    const user = { id: 'u1', role: 'user' as const, content: '熵是什么？' }
    const noCite = { id: 'a3', role: 'assistant' as const, content: '没有引用的回答' }

    const { result } = renderHook(() => useCitationAudit('tb1', [user, FAKE, REAL, noCite]))

    await waitFor(() => expect(result.current.size).toBe(1))
    expect(result.current.get('a1')).toEqual(new Set([MARKER]))
    expect(result.current.has('a2')).toBe(false)
    expect(result.current.has('a3')).toBe(false)
    expect(result.current.has('u1')).toBe(false)
    expect(data.getTextbook).toHaveBeenCalledWith('tb1')
  })

  it('does not flag short citations that cannot be verified', async () => {
    data.getTextbook.mockResolvedValue({ content: BOOK })
    const short = {
      id: 'a1',
      role: 'assistant' as const,
      content: `> ${MARKER}\n> 熵`
    }

    const { result } = renderHook(() => useCitationAudit('tb1', [short]))
    await waitFor(() => expect(data.getTextbook).toHaveBeenCalledTimes(1))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.size).toBe(0)
  })

  it('stays empty when the textbook is missing, empty or unreadable', async () => {
    data.getTextbook.mockResolvedValueOnce(null)
    const first = renderHook(() => useCitationAudit('tb1', [FAKE]))
    await act(async () => {
      await Promise.resolve()
    })
    expect(first.result.current.size).toBe(0)
    first.unmount()

    data.getTextbook.mockResolvedValueOnce({ content: '' })
    const second = renderHook(() => useCitationAudit('tb1', [FAKE]))
    await act(async () => {
      await Promise.resolve()
    })
    expect(second.result.current.size).toBe(0)
    second.unmount()

    data.getTextbook.mockRejectedValueOnce(new Error('db closed'))
    const third = renderHook(() => useCitationAudit('tb1', [FAKE]))
    await act(async () => {
      await Promise.resolve()
    })
    expect(third.result.current.size).toBe(0)
  })

  it('drops late resolutions and rejections after unmount', async () => {
    const pending = deferred<{ content: string } | null>()
    data.getTextbook.mockReturnValueOnce(pending.promise)
    const resolved = renderHook(() => useCitationAudit('tb1', [FAKE]))
    resolved.unmount()
    pending.resolve({ content: BOOK })

    const failing = deferred<never>()
    data.getTextbook.mockReturnValueOnce(failing.promise)
    const rejected = renderHook(() => useCitationAudit('tb1', [FAKE]))
    rejected.unmount()
    failing.reject(new Error('late failure'))

    await act(async () => {
      await Promise.resolve()
    })
    // No assertion on state (unmounted) — the point is that neither late
    // settle path throws or updates.
    expect(data.getTextbook).toHaveBeenCalledTimes(2)
  })
})
