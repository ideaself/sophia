import { mkdir, writeFile, readFile, access, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Textbook } from '../../shared/schemas/textbook'
import { TextbookSchema } from '../../shared/schemas/textbook'
import type { TextbookId, WorldId } from '../../shared/types/ids'
import {
  textbooksDir,
  textbookDir,
  textbookPath,
  textbookContentPath
} from './app-data'

export interface CreateTextbookInput {
  worldId: WorldId
  title: string
  format: 'markdown' | 'text' | 'pdf' | 'epub'
  sourceFile?: string
  content?: string
}

let idCounter = 0

function generateId(): TextbookId {
  idCounter += 1
  return `tb_${Date.now()}_${idCounter}` as TextbookId
}

export class TextbookStore {
  constructor(private readonly dataRoot: string) {}

  async create(input: CreateTextbookInput): Promise<Textbook> {
    const now = new Date().toISOString()
    const id = generateId() as TextbookId

    const raw: Record<string, unknown> = {
      id,
      worldId: input.worldId,
      title: input.title,
      format: input.format,
      sourceFile: input.sourceFile ?? '',
      content: input.content ?? '',
      progress: { currentPage: 0, totalPages: null },
      createdAt: now,
      updatedAt: now
    }
    const textbook = raw as unknown as Textbook



    await mkdir(textbookDir(this.dataRoot, id, input.worldId), { recursive: true })
    await writeFile(
      textbookPath(this.dataRoot, id, input.worldId),
      JSON.stringify(textbook, null, 2),
      'utf-8'
    )

    if (input.content) {
      await writeFile(
        textbookContentPath(this.dataRoot, id, input.worldId),
        input.content,
        'utf-8'
      )
    }

    return textbook
  }

  async get(textbookId: string, worldId: string): Promise<Textbook | null> {
    try {
      const content = await readFile(
        textbookPath(this.dataRoot, textbookId, worldId),
        'utf-8'
      )
      const parsed = TextbookSchema.parse(JSON.parse(content))
      return parsed as unknown as Textbook
    } catch {
      return null
    }
  }

  async list(worldId: string): Promise<Textbook[]> {
    try {
      await access(textbooksDir(this.dataRoot, worldId))
    } catch {
      return []
    }

    const entries = await readdir(textbooksDir(this.dataRoot, worldId))
    const textbooks: Textbook[] = []

    for (const entry of entries) {
      const tb = await this.get(entry, worldId)
      if (tb) {
        textbooks.push(tb)
      }
    }

    return textbooks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async updateContent(textbookId: string, worldId: string, content: string): Promise<Textbook | null> {
    const tb = await this.get(textbookId, worldId)
    if (!tb) return null

    tb.content = content
    tb.updatedAt = new Date().toISOString()

    await writeFile(
      textbookPath(this.dataRoot, textbookId, worldId),
      JSON.stringify(tb, null, 2),
      'utf-8'
    )
    await writeFile(
      textbookContentPath(this.dataRoot, textbookId, worldId),
      content,
      'utf-8'
    )

    return tb
  }

  async delete(textbookId: string, worldId: string): Promise<boolean> {
    try {
      const dir = textbookDir(this.dataRoot, textbookId, worldId)
      await access(dir)
      const files = await readdir(dir)
      for (const file of files) {
        await unlink(join(dir, file))
      }
      await unlink(dir)
      return true
    } catch {
      return false
    }
  }

  async getContent(textbookId: string, worldId: string): Promise<string> {
    try {
      return await readFile(
        textbookContentPath(this.dataRoot, textbookId, worldId),
        'utf-8'
      )
    } catch {
      const tb = await this.get(textbookId, worldId)
      return tb?.content ?? ''
    }
  }
}
