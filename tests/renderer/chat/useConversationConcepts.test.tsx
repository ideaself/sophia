// @vitest-environment jsdom
/**
 * useConversationConcepts — loads the active conversation's concepts and
 * refreshes them when `concepts:updated` reports the same conversation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { useConversationConcepts } from '../../../src/renderer/src/chat/useConversationConcepts'

const data = {
  listConcepts: vi.fn(),
  onConceptsUpdated: vi.fn()
}

let updateCb: ((payload: { conversationId: string }) => void) | null = null

beforeEach(() => {
  updateCb = null
  data.listConcepts.mockReset().mockResolvedValue([])
  data.onConceptsUpdated.mockReset().mockImplementation((cb: (payload: { conversationId: string }) => void) => {
    updateCb = cb
    return () => {
      updateCb = null
    }
  })
  Object.defineProperty(window, 'sophia', { configurable: true, value: { data } })
})

afterEach(cleanup)

describe('useConversationConcepts', () => {
  it('stays empty without a conversation and skips loading', () => {
    const { result } = renderHook(() => useConversationConcepts(null))
    expect(result.current).toEqual([])
    expect(data.listConcepts).not.toHaveBeenCalled()
    expect(data.onConceptsUpdated).not.toHaveBeenCalled()
  })

  it('loads on mount and refreshes only for the active conversation', async () => {
    data.listConcepts.mockResolvedValueOnce([{ id: 'k1', name: '熵' }])
    const { result } = renderHook(() => useConversationConcepts('conv_1'))

    await waitFor(() => expect(result.current.map((c) => c.name)).toEqual(['熵']))
    expect(data.listConcepts).toHaveBeenCalledWith('conv_1')

    // Mismatched conversation: ignored.
    act(() => updateCb?.({ conversationId: 'conv_other' }))
    expect(data.listConcepts).toHaveBeenCalledTimes(1)

    // Matching conversation: reloaded.
    data.listConcepts.mockResolvedValueOnce([
      { id: 'k1', name: '熵' },
      { id: 'k2', name: '焓' }
    ])
    act(() => updateCb?.({ conversationId: 'conv_1' }))
    await waitFor(() => expect(result.current).toHaveLength(2))
  })

  it('tolerates load failures and drops late settle results after unmount', async () => {
    // Failure while mounted → empty list.
    data.listConcepts.mockRejectedValueOnce(new Error('ipc down'))
    const first = renderHook(() => useConversationConcepts('conv_1'))
    await waitFor(() => expect(first.result.current).toEqual([]))
    first.unmount()

    // Late resolution after unmount is ignored (and must not warn).
    let resolveLoad!: (value: unknown[]) => void
    data.listConcepts.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve as (value: unknown[]) => void
      })
    )
    const second = renderHook(() => useConversationConcepts('conv_1'))
    await waitFor(() => expect(data.listConcepts).toHaveBeenCalledTimes(2))
    second.unmount()
    resolveLoad([{ id: 'k1', name: '熵' }])
    await act(async () => {
      await Promise.resolve()
    })

    // Late rejection after unmount is ignored too.
    let rejectLoad!: (err: unknown) => void
    data.listConcepts.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectLoad = reject
      })
    )
    const third = renderHook(() => useConversationConcepts('conv_1'))
    await waitFor(() => expect(data.listConcepts).toHaveBeenCalledTimes(3))
    third.unmount()
    rejectLoad(new Error('late failure'))
    await act(async () => {
      await Promise.resolve()
    })

    // Unsubscribe ran: the captured callback is gone.
    expect(updateCb).toBeNull()
  })
})
