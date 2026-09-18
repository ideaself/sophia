/**
 * ReadingNoteStore — list filtering, corrupt-file tolerance, partial updates
 * and delete guards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { ReadingNoteStore } from '../../../src/main/storage/reading-note-store'
import { textbookNotesDir } from '../../../src/main/storage/app-data'

let dataRoot = ''

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-notes-'))
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('ReadingNoteStore', () => {
  it('skips non-json files and warns on corrupt notes', async () => {
    const store = new ReadingNoteStore(dataRoot)
    const note = await store.create({ textbookId: 'tb_1', content: '熵是状态函数', position: '1' })

    const dir = textbookNotesDir(dataRoot, 'tb_1')
    await writeFile(join(dir, 'README.txt'), 'not a note')
    await writeFile(join(dir, 'broken.json'), '{not valid json')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const notes = await store.list('tb_1')
      expect(notes.map((n) => n.id)).toEqual([note.id])
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('broken.json'),
        expect.anything()
      )
    } finally {
      warn.mockRestore()
    }

    // The corrupt file is left in place (nothing deletes user data silently).
    expect(await readdir(dir)).toContain('broken.json')
  })

  it('applies every editable field', async () => {
    const store = new ReadingNoteStore(dataRoot)
    const note = await store.create({
      textbookId: 'tb_1',
      content: '旧内容',
      position: '1',
      type: 'highlight'
    })

    const updated = await store.update(note.id, 'tb_1', {
      content: '新内容',
      position: '42',
      chapter: '第一章',
      type: 'note',
      color: '#fff',
      readerNote: '复习重点'
    })

    expect(updated).toMatchObject({
      content: '新内容',
      position: '42',
      chapter: '第一章',
      type: 'note',
      color: '#fff',
      readerNote: '复习重点'
    })
  })

  it('leaves readerNote untouched when it is not part of the update', async () => {
    const store = new ReadingNoteStore(dataRoot)
    const note = await store.create({
      textbookId: 'tb_1',
      content: '旧内容',
      position: '1',
      readerNote: '原批注'
    })

    const updated = await store.update(note.id, 'tb_1', { content: '只改正文' })

    expect(updated?.readerNote).toBe('原批注')
  })

  it('returns null for a missing note and for unreadable files', async () => {
    const store = new ReadingNoteStore(dataRoot)

    await expect(store.update('note_missing', 'tb_1', { content: 'x' })).resolves.toBeNull()

    // A directory where the note file belongs → warn + null.
    const dir = textbookNotesDir(dataRoot, 'tb_1')
    await mkdir(join(dir, 'note_broken.json'), { recursive: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(store.update('note_broken', 'tb_1', { content: 'x' })).resolves.toBeNull()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('note_broken'),
        expect.anything()
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('reports a failed delete', async () => {
    const store = new ReadingNoteStore(dataRoot)
    await expect(store.delete('note_missing', 'tb_1')).resolves.toBe(false)
  })
})
