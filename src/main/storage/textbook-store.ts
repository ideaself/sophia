import { mkdir, readFile, access, readdir, rm, copyFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Textbook } from '../../shared/schemas/textbook'
import { TextbookSchema } from '../../shared/schemas/textbook'
import type { TextbookId } from '../../shared/types/ids'
import {
  textbooksDir,
  textbookDir,
  textbookPath,
  textbookContentPath,
  textbookOriginalPath
} from './app-data'
import { isNotFoundError, warnReadFailure } from './fs-errors'
import { atomicWriteFile } from './atomic-write'

export interface CreateTextbookInput {
  title: string
  author?: string
  description?: string
  format: 'markdown' | 'text' | 'pdf' | 'epub'
  sourceFile?: string
  content?: string
  originalSourcePath?: string
}

let idCounter = 0

function generateId(): TextbookId {
  idCounter += 1
  return `tb_${Date.now()}_${idCounter}` as TextbookId
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

export class TextbookStore {
  constructor(private readonly dataRoot: string) {}

  async create(input: CreateTextbookInput): Promise<Textbook> {
    const now = new Date().toISOString()
    const id = generateId() as TextbookId

    // Preserve the original filename (sanitized) so it's recognizable on the
    // WebDAV server and in the file system, instead of a generic "source.*".
    let originalFile = ''
    if (input.originalSourcePath) {
      const baseName = input.sourceFile || input.originalSourcePath.split(/[/\\]/).pop() || ''
      originalFile = sanitizeFileName(baseName) || `source.${input.format === 'epub' ? 'epub' : 'pdf'}`
    }

    const raw: Record<string, unknown> = {
      id,
      
      title: input.title,
      author: input.author ?? '',
      description: input.description ?? '',
      format: input.format,
      sourceFile: input.sourceFile ?? '',
      originalFile,
      content: input.content ?? '',
      fileHash: '',
      progress: { currentPage: 0, totalPages: null, readingPercentage: 0, lastPosition: '' },
      rating: 0,
      isDeleted: false,
      createdAt: now,
      updatedAt: now
    }
    const textbook = raw as unknown as Textbook

    await mkdir(textbookDir(this.dataRoot, id, ), { recursive: true })

    if (input.originalSourcePath) {
      try {
        textbook.fileHash = await computeFileHash(input.originalSourcePath)
      } catch {
        // best-effort
      }
      await copyFile(
        input.originalSourcePath,
        textbookOriginalPath(this.dataRoot, id, originalFile, )
      )
    }

    await atomicWriteFile(
      textbookPath(this.dataRoot, id, ),
      JSON.stringify(textbook, null, 2),
      'utf-8'
    )

    if (input.content) {
      await atomicWriteFile(
        textbookContentPath(this.dataRoot, id, ),
        input.content,
        'utf-8'
      )
    }

    return textbook
  }

  async get(textbookId: string): Promise<Textbook | null> {
    try {
      const content = await readFile(
        textbookPath(this.dataRoot, textbookId),
        'utf-8'
      )
      const result = TextbookSchema.safeParse(JSON.parse(content))
      if (!result.success) {
        warnReadFailure(`textbook ${textbookId} (schema mismatch)`, result.error)
        return null
      }
      return result.data as unknown as Textbook
    } catch (err) {
      if (!isNotFoundError(err)) warnReadFailure(`textbook ${textbookId}`, err)
      return null
    }
  }

  async list(): Promise<Textbook[]> {
    try {
      await access(textbooksDir(this.dataRoot))
    } catch {
      return []
    }

    const entries = await readdir(textbooksDir(this.dataRoot))
    const textbooks: Textbook[] = []

    for (const entry of entries) {
      const tb = await this.get(entry)
      if (tb && !tb.isDeleted) {
        textbooks.push(tb)
      }
    }

    return textbooks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async updateContent(textbookId: string, content: string): Promise<Textbook | null> {
    const tb = await this.get(textbookId)
    if (!tb) return null

    tb.content = content
    tb.updatedAt = new Date().toISOString()

    await atomicWriteFile(
      textbookPath(this.dataRoot, textbookId),
      JSON.stringify(tb, null, 2),
      'utf-8'
    )
    await atomicWriteFile(
      textbookContentPath(this.dataRoot, textbookId),
      content,
      'utf-8'
    )

    return tb
  }

  async update(textbookId: string, updates: { title?: string; author?: string; description?: string; content?: string; rating?: number }): Promise<Textbook | null> {
    const tb = await this.get(textbookId)
    if (!tb) return null

    if (updates.title !== undefined) tb.title = updates.title
    if (updates.author !== undefined) tb.author = updates.author
    if (updates.description !== undefined) tb.description = updates.description
    if (updates.content !== undefined) tb.content = updates.content
    if (updates.rating !== undefined) tb.rating = updates.rating
    tb.updatedAt = new Date().toISOString()

    await atomicWriteFile(
      textbookPath(this.dataRoot, textbookId),
      JSON.stringify(tb, null, 2),
      'utf-8'
    )
    if (updates.content !== undefined) {
      await atomicWriteFile(
        textbookContentPath(this.dataRoot, textbookId),
        updates.content,
        'utf-8'
      )
    }

    return tb
  }

  async updateProgress(
    textbookId: string,
    progress: { currentPage?: number; totalPages?: number | null; readingPercentage?: number; lastPosition?: string }
  ): Promise<Textbook | null> {
    const tb = await this.get(textbookId)
    if (!tb) return null

    if (progress.currentPage !== undefined) tb.progress.currentPage = progress.currentPage
    if (progress.totalPages !== undefined) tb.progress.totalPages = progress.totalPages
    if (progress.readingPercentage !== undefined) tb.progress.readingPercentage = progress.readingPercentage
    if (progress.lastPosition !== undefined) tb.progress.lastPosition = progress.lastPosition
    tb.updatedAt = new Date().toISOString()

    await atomicWriteFile(
      textbookPath(this.dataRoot, textbookId),
      JSON.stringify(tb, null, 2),
      'utf-8'
    )

    return tb
  }

  async delete(textbookId: string): Promise<boolean> {
    try {
      const dir = textbookDir(this.dataRoot, textbookId)
      await rm(dir, { recursive: true, force: true })
      return true
    } catch {
      /* v8 ignore next -- @preserve */
      return false
    }
  }

  async softDelete(textbookId: string): Promise<boolean> {
    const tb = await this.get(textbookId)
    if (!tb) return false
    tb.isDeleted = true
    tb.updatedAt = new Date().toISOString()
    await atomicWriteFile(
      textbookPath(this.dataRoot, textbookId),
      JSON.stringify(tb, null, 2),
      'utf-8'
    )
    return true
  }

  async getContent(textbookId: string): Promise<string> {
    try {
      return await readFile(
        textbookContentPath(this.dataRoot, textbookId),
        'utf-8'
      )
    } catch {
      const tb = await this.get(textbookId)
      return tb?.content ?? ''
    }
  }

  async readOriginal(
    textbookId: string,
    ): Promise<{ data: Buffer; fileName: string } | null> {
    const tb = await this.get(textbookId)
    if (!tb || !tb.originalFile) return null

    const dir = textbookDir(this.dataRoot, textbookId)
    const fileName = tb.sourceFile.split(/[/\\]/).pop() || tb.originalFile

    try {
      // Try the stored originalFile name first
      const data = await readFile(join(dir, tb.originalFile))
      return { data, fileName }
    } catch {
      // Backward compatibility: try legacy "source.*" naming
      try {
        const ext = tb.format === 'epub' ? 'epub' : 'pdf'
        const data = await readFile(join(dir, `source.${ext}`))
        return { data, fileName }
      } catch {
        return null
      }
    }
  }
}
