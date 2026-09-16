/**
 * In-conversation search (Ctrl+F) state for the classroom.
 *
 * Extracted from ClassroomView: the open/query/match state and the close
 * semantics are self-contained, while scrolling/anchoring stays in the view
 * (the view reacts to `searchOpen` turning false and re-evaluates its
 * stick-to-bottom anchor).
 */

import { useCallback, useMemo, useRef, useState } from 'react'

export interface ConversationSearch {
  searchOpen: boolean
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  searchQuery: string
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>
  matchIndex: number
  setMatchIndex: React.Dispatch<React.SetStateAction<number>>
  searchInputRef: React.RefObject<HTMLInputElement | null>
  /** Close the search bar and clear query/match state. */
  closeSearch: () => void
}

export function useConversationSearch(): ConversationSearch {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setMatchIndex(0)
  }, [])

  // Stable identity while the search state is unchanged (consumers use it in
  // effect/callback dependency arrays).
  return useMemo(() => ({
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    matchIndex,
    setMatchIndex,
    searchInputRef,
    closeSearch
  }), [searchOpen, searchQuery, matchIndex, closeSearch])
}

/**
 * Indices of messages whose content contains the query (case-insensitive).
 * Pure — kept outside the hook so it can be memoized on the message list.
 */
export function findMessageMatches(
  messages: Array<{ content: string }>,
  query: string
): number[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const matches: number[] = []
  messages.forEach((m, i) => {
    if (m.content.toLowerCase().includes(q)) matches.push(i)
  })
  return matches
}
