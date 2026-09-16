/**
 * In-conversation search bar (Ctrl+F) — extracted from ClassroomView.
 */

import type { RefObject } from 'react'

export function ConversationSearchBar({
  inputRef,
  query,
  matchIndex,
  matchCount,
  onQueryChange,
  onGoToMatch,
  onClose
}: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  matchIndex: number
  matchCount: number
  onQueryChange: (value: string) => void
  onGoToMatch: (dir: 1 | -1) => void
  onClose: () => void
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2 border-b border-surface-border bg-bg-surface px-4 py-1.5">
      <span className="text-xs text-text-muted">🔍</span>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            onGoToMatch(e.shiftKey ? -1 : 1)
          }
          if (e.key === 'Escape') {
            onClose()
          }
        }}
        placeholder="搜索本对话..."
        className="w-44 rounded border border-surface-border-strong bg-bg-deep px-2 py-1 text-xs text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
      />
      <span className="w-14 text-right text-xs tabular-nums text-text-muted">
        {matchCount > 0
          ? `${Math.min(matchIndex, matchCount - 1) + 1}/${matchCount}`
          : '0/0'}
      </span>
      <button
        onClick={() => onGoToMatch(-1)}
        disabled={matchCount === 0}
        className="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-secondary disabled:opacity-40"
        title="上一个 (Shift+Enter)"
      >
        ↑
      </button>
      <button
        onClick={() => onGoToMatch(1)}
        disabled={matchCount === 0}
        className="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-secondary disabled:opacity-40"
        title="下一个 (Enter)"
      >
        ↓
      </button>
      <button
        onClick={onClose}
        className="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
        title="关闭搜索 (Esc)"
      >
        ✕
      </button>
    </div>
  )
}
