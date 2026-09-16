// @vitest-environment jsdom
/**
 * useReadingNotes — shared reader-notes hook.
 *
 * The EPUB reader previously missed try/catch on update/delete; these tests
 * lock the failure-safe contract for both readers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'

import { useReadingNotes } from '../../../src/renderer/src/reader/useReadingNotes'

const note = (id: string, readerNote = '') => ({
  id,
  textbookId: 'tb_1',
  content: `highlight ${id}`,
  position: '3',
  chapter: '第三章',
  type: 'highlight' as const,
  color: '',
  readerNote,
  createdAt: '2026-07-06T09:00:00Z',
  updatedAt: '2026-07-06T09:00:00Z'
})

const api = {
  listReadingNotes: vi.fn(),
  createReadingNote: vi.fn(),
  updateReadingNote: vi.fn(),
  deleteReadingNote: vi.fn()
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear()
  api.listReadingNotes.mockResolvedValue([note('n1'), note('n2')])
  api.createReadingNote.mockResolvedValue(note('n3'))
  api.updateReadingNote.mockResolvedValue(null)
  api.deleteReadingNote.mockResolvedValue(true)

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data: api }
  })
})

afterEach(() => {
  cleanup()
})

async function mountHook() {
  const rendered = renderHook(() => useReadingNotes('tb_1'))
  await waitFor(() => expect(rendered.result.current.notes).toHaveLength(2))
  return rendered
}

describe('useReadingNotes', () => {
  it('loads notes for the textbook on mount', async () => {
    await mountHook()
    expect(api.listReadingNotes).toHaveBeenCalledWith('tb_1')
  })

  it('creates a note, refreshes the list and reports success', async () => {
    const { result } = await mountHook()
    api.listReadingNotes.mockResolvedValueOnce([note('n1'), note('n2'), note('n3')])

    let ok = false
    await act(async () => {
      ok = await result.current.createNote({
        content: 'new highlight',
        position: '5',
        chapter: '第五章',
        type: 'note'
      })
    })

    expect(ok).toBe(true)
    expect(api.createReadingNote).toHaveBeenCalledWith(
      expect.objectContaining({ textbookId: 'tb_1', content: 'new highlight', position: '5' })
    )
    expect(result.current.notes).toHaveLength(3)
  })

  it('returns false and keeps the list when creating fails', async () => {
    const { result } = await mountHook()
    api.createReadingNote.mockRejectedValueOnce(new Error('ipc down'))

    let ok = true
    await act(async () => {
      ok = await result.current.createNote({ content: 'x', position: '1' })
    })

    expect(ok).toBe(false)
    expect(result.current.notes).toHaveLength(2)
  })

  it('updates a note text optimistically', async () => {
    const { result } = await mountHook()

    let ok = false
    await act(async () => {
      ok = await result.current.updateNoteText('n1', '新的批注文字')
    })

    expect(ok).toBe(true)
    expect(api.updateReadingNote).toHaveBeenCalledWith('n1', 'tb_1', { readerNote: '新的批注文字' })
    expect(result.current.notes.find((n) => n.id === 'n1')?.readerNote).toBe('新的批注文字')
  })

  it('returns false without throwing when updating fails (regression: EPUB had no catch)', async () => {
    const { result } = await mountHook()
    api.updateReadingNote.mockRejectedValueOnce(new Error('ipc down'))

    let ok = true
    await act(async () => {
      ok = await result.current.updateNoteText('n1', 'text')
    })

    expect(ok).toBe(false)
    expect(result.current.notes.find((n) => n.id === 'n1')?.readerNote).toBe('')
  })

  it('deletes a note locally and reports failure safely', async () => {
    const { result } = await mountHook()

    await act(async () => {
      await result.current.removeNote('n1')
    })
    expect(api.deleteReadingNote).toHaveBeenCalledWith('n1', 'tb_1')
    expect(result.current.notes.map((n) => n.id)).toEqual(['n2'])

    api.deleteReadingNote.mockRejectedValueOnce(new Error('ipc down'))
    let ok = true
    await act(async () => {
      ok = await result.current.removeNote('n2')
    })
    expect(ok).toBe(false)
    expect(result.current.notes.map((n) => n.id)).toEqual(['n2'])
  })
})
