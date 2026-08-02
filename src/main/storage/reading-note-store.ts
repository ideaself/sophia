import { mkdir, writeFile, readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { ReadingNoteId } from '../../shared/types/ids'
import { textbookNotesDir } from './app-data'
import { isNotFoundError, warnReadFailure } from './fs-errors'
import { atomicWriteFile } from './atomic-write'

export const ReadingNoteSchema = z.object({
  id: z.string().min(1),
  textbookId: z.string().min(1),
  worldId: z.string().min(1),
  content: z.string(),
  position: z.string(),
  chapter: z.string().default(''),
  type: z.enum(['highlight', 'underline', 'note', 'bookmark']).default('highlight'),
  color: z.string().default(''),
  readerNote: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string()
})

export type ReadingNote = z.infer<typeof ReadingNoteSchema>

export interface CreateReadingNoteInput {
  textbookId: string
  worldId: string
  content: string
  position: string
  chapter?: string
  type?: 'highlight' | 'underline' | 'note' | 'bookmark'
  color?: string
  readerNote?: string
}

let idCounter = 0

function generateId(): ReadingNoteId {
  idCounter += 1
  return `rn_${Date.now()}_${idCounter}` as ReadingNoteId
}

export class ReadingNoteStore {
  constructor(private readonly dataRoot: string) {}

  private notePath(textbookId: string, noteId: string, worldId: string): string {
    return join(textbookNotesDir(this.dataRoot, textbookId, worldId), `${noteId}.json`)
  }

  async create(input: CreateReadingNoteInput): Promise<ReadingNote> {
    const now = new Date().toISOString()
    const id = generateId()

    const note: ReadingNote = {
      id,
      textbookId: input.textbookId,
      worldId: input.worldId,
      content: input.content,
      position: input.position,
      chapter: input.chapter ?? '',
      type: input.type ?? 'highlight',
      color: input.color ?? '',
      readerNote: input.readerNote ?? '',
      createdAt: now,
      updatedAt: now
    }

    await mkdir(textbookNotesDir(this.dataRoot, input.textbookId, input.worldId), { recursive: true })
    await atomicWriteFile(this.notePath(input.textbookId, id, input.worldId), JSON.stringify(note, null, 2), 'utf-8')
    return note
  }

  async list(textbookId: string, worldId: string): Promise<ReadingNote[]> {
    try {
      const dir = textbookNotesDir(this.dataRoot, textbookId, worldId)
      const files = await readdir(dir)
      const notes: ReadingNote[] = []
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const content = await readFile(join(dir, file), 'utf-8')
          const parsed = ReadingNoteSchema.parse(JSON.parse(content))
          notes.push(parsed)
        } catch (err) {
          warnReadFailure(`reading note ${file}`, err)
        }
      }
      return notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    } catch {
      return []
    }
  }

  async update(noteId: string, textbookId: string, worldId: string, updates: Partial<CreateReadingNoteInput>): Promise<ReadingNote | null> {
    try {
      const content = await readFile(this.notePath(textbookId, noteId, worldId), 'utf-8')
      const note = ReadingNoteSchema.parse(JSON.parse(content))
      if (updates.content !== undefined) note.content = updates.content
      if (updates.position !== undefined) note.position = updates.position
      if (updates.chapter !== undefined) note.chapter = updates.chapter
      if (updates.type !== undefined) note.type = updates.type
      if (updates.color !== undefined) note.color = updates.color
      if (updates.readerNote !== undefined) note.readerNote = updates.readerNote
      note.updatedAt = new Date().toISOString()
      await atomicWriteFile(this.notePath(textbookId, noteId, worldId), JSON.stringify(note, null, 2), 'utf-8')
      return note
    } catch (err) {
      if (!isNotFoundError(err)) warnReadFailure(`reading note ${noteId}`, err)
      return null
    }
  }

  async delete(noteId: string, textbookId: string, worldId: string): Promise<boolean> {
    try {
      await unlink(this.notePath(textbookId, noteId, worldId))
      return true
    } catch {
      return false
    }
  }
}
