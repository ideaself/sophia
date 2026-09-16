/**
 * Shared reading-notes state for the EPUB / PDF readers.
 *
 * Both readers previously carried near-identical copies of the load/create/
 * update/delete bookkeeping — and the EPUB copy missed try/catch on update
 * and delete, surfacing IPC failures as unhandled rejections. All operations
 * here are failure-safe and report success to the caller.
 */

import { useCallback, useEffect, useState } from 'react'

export interface CreateReadingNoteInput {
  content: string
  position: string
  chapter?: string
  type?: 'highlight' | 'underline' | 'note' | 'bookmark'
  color?: string
  readerNote?: string
}

export interface ReadingNotesApi {
  notes: ReadingNoteDTO[]
  /** Re-fetch the full list (best-effort — clears on failure). */
  refresh: () => Promise<void>
  /** Create a note; returns false when the write failed. */
  createNote: (input: CreateReadingNoteInput) => Promise<boolean>
  /** Update the note's reader text; optimistic local update on success. */
  updateNoteText: (noteId: string, readerNote: string) => Promise<boolean>
  /** Delete a note; optimistic local removal on success. */
  removeNote: (noteId: string) => Promise<boolean>
}

export function useReadingNotes(textbookId: string): ReadingNotesApi {
  const [notes, setNotes] = useState<ReadingNoteDTO[]>([])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await window.sophia.data.listReadingNotes(textbookId)
      setNotes(list)
    } catch {
      setNotes([])
    }
  }, [textbookId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createNote = useCallback(async (input: CreateReadingNoteInput): Promise<boolean> => {
    try {
      await window.sophia.data.createReadingNote({ textbookId, ...input })
      setNotes(await window.sophia.data.listReadingNotes(textbookId))
      return true
    } catch {
      return false
    }
  }, [textbookId])

  const updateNoteText = useCallback(async (noteId: string, readerNote: string): Promise<boolean> => {
    try {
      await window.sophia.data.updateReadingNote(noteId, textbookId, { readerNote })
      setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, readerNote } : n)))
      return true
    } catch {
      return false
    }
  }, [textbookId])

  const removeNote = useCallback(async (noteId: string): Promise<boolean> => {
    try {
      await window.sophia.data.deleteReadingNote(noteId, textbookId)
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
      return true
    } catch {
      return false
    }
  }, [textbookId])

  return { notes, refresh, createNote, updateNoteText, removeNote }
}
