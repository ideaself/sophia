// @vitest-environment jsdom
/**
 * useConversationSearch + findMessageMatches — in-conversation search state.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

import {
  useConversationSearch,
  findMessageMatches
} from '../../../src/renderer/src/chat/useConversationSearch'

afterEach(() => {
  cleanup()
})

describe('findMessageMatches', () => {
  const messages = [
    { content: 'What is Entropy?' },
    { content: '熵是无序度的度量' },
    { content: 'entropy again, lowercase' }
  ]

  it('matches case-insensitively and returns indices', () => {
    expect(findMessageMatches(messages, 'entropy')).toEqual([0, 2])
    expect(findMessageMatches(messages, 'ENTROPY')).toEqual([0, 2])
  })

  it('matches non-latin content', () => {
    expect(findMessageMatches(messages, '无序度')).toEqual([1])
  })

  it('returns [] for empty or whitespace-only queries', () => {
    expect(findMessageMatches(messages, '')).toEqual([])
    expect(findMessageMatches(messages, '   ')).toEqual([])
  })

  it('returns [] when nothing matches', () => {
    expect(findMessageMatches(messages, 'missing')).toEqual([])
  })
})

describe('useConversationSearch', () => {
  it('starts closed with empty state', () => {
    const { result } = renderHook(() => useConversationSearch())
    expect(result.current.searchOpen).toBe(false)
    expect(result.current.searchQuery).toBe('')
    expect(result.current.matchIndex).toBe(0)
    expect(result.current.searchInputRef.current).toBeNull()
  })

  it('closeSearch resets open/query/match', () => {
    const { result } = renderHook(() => useConversationSearch())

    act(() => {
      result.current.setSearchOpen(true)
      result.current.setSearchQuery('entropy')
      result.current.setMatchIndex(2)
    })
    expect(result.current.searchOpen).toBe(true)
    expect(result.current.searchQuery).toBe('entropy')

    act(() => {
      result.current.closeSearch()
    })
    expect(result.current.searchOpen).toBe(false)
    expect(result.current.searchQuery).toBe('')
    expect(result.current.matchIndex).toBe(0)
  })

  it('keeps a stable identity while state is unchanged', () => {
    const { result, rerender } = renderHook(() => useConversationSearch())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
