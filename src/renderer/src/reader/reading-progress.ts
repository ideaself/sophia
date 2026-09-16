/**
 * Shared reading-progress plumbing for the EPUB / PDF readers.
 *
 * The two readers persist different payloads (EPUB: chapter + font size +
 * scroll as JSON; PDF: the page number) but share the same two sinks:
 * - localStorage, keyed per textbook (offline, best-effort);
 * - the textbook store, synced via WebDAV (`updateTextbookProgress`).
 *
 * Storage failures must never break reading, so every helper swallows its
 * errors (restore code treats a miss as "start from the beginning").
 */

export type ReaderKind = 'epub' | 'pdf'

export interface ReadingProgressPatch {
  currentPage: number
  totalPages: number
  readingPercentage: number
  /** EPUB: the full local progress blob so another device can restore it. */
  lastPosition?: string
}

/** Progress previously synced from another device (or an earlier session). */
export interface SyncedProgress {
  currentPage: number
  totalPages: number | null
  readingPercentage: number
  lastPosition: string
}

export function progressStorageKey(kind: ReaderKind, textbookId: string): string {
  return `${kind}-progress-${textbookId}`
}

export function readLocalProgress(kind: ReaderKind, textbookId: string): string | null {
  try {
    return localStorage.getItem(progressStorageKey(kind, textbookId))
  } catch {
    return null
  }
}

export function writeLocalProgress(kind: ReaderKind, textbookId: string, value: string): void {
  try {
    localStorage.setItem(progressStorageKey(kind, textbookId), value)
  } catch {
    // quota exceeded / storage disabled — best-effort only
  }
}

/** Fire-and-forget store sync (WebDAV); a failure must never break reading. */
export function syncReadingProgress(textbookId: string, patch: ReadingProgressPatch): void {
  void window.sophia.data.updateTextbookProgress(textbookId, patch).catch(() => {})
}

/** Store-side progress, or null when unavailable (missing textbook / error). */
export async function loadSyncedProgress(textbookId: string): Promise<SyncedProgress | null> {
  try {
    const tb = await window.sophia.data.getTextbook(textbookId)
    return tb?.progress ?? null
  } catch {
    return null
  }
}
