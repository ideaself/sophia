/**
 * Shared Ctrl+F search popover shell for the EPUB / PDF readers: the anchored
 * panel, the styled input and a `controls` slot (prev/next or search button).
 * Result rendering stays with each caller — the readers match differently
 * (in-chapter marks vs. per-page hits).
 */

import type { RefObject } from 'react'

export interface ReaderSearchPopoverProps {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  onQueryChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder: string
  /** Buttons rendered next to the input (prev/next, search, …). */
  controls?: React.ReactNode
  /** Result area below the input row. */
  children?: React.ReactNode
  /** Panel width class — the EPUB reader uses a wider panel. */
  widthClass?: string
}

export function ReaderSearchPopover({
  inputRef,
  query,
  onQueryChange,
  onKeyDown,
  placeholder,
  controls,
  children,
  widthClass = 'w-80'
}: ReaderSearchPopoverProps): React.ReactElement {
  return (
    <div
      className={`absolute right-0 top-full z-10 mt-1 ${widthClass} rounded border border-surface-border bg-bg-surface p-3 shadow-lg`}
    >
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full rounded border border-surface-border-strong bg-bg-deep px-2 py-1 text-xs text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
        />
        {controls}
      </div>
      {children}
    </div>
  )
}
