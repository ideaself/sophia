import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { TextbookStore } from '../../../src/main/storage/textbook-store'
import { textbookContentPath } from '../../../src/main/storage/app-data'
import type { WorldId } from '../../../src/shared/types/ids'

const WORLD_ID = 'world_default' as WorldId
const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x01, 0x02, 0x03])

let dataRoot: string
let importDir: string

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-tbstore-'))
  importDir = await mkdtemp(join(tmpdir(), 'sophia-import-'))
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
  await rm(importDir, { recursive: true, force: true })
})

async function createPdfTextbook(store: TextbookStore, withOriginal: boolean) {
  let originalSourcePath: string | undefined
  if (withOriginal) {
    originalSourcePath = join(importDir, '高等数学.pdf')
    await writeFile(originalSourcePath, PDF_BYTES)
  }
  return store.create({
    worldId: WORLD_ID,
    title: '高等数学',
    format: 'pdf',
    sourceFile: '高等数学.pdf',
    content: '# 解析文本',
    originalSourcePath
  })
}

describe('TextbookStore — original file', () => {
  it('create with originalSourcePath copies the file into the textbook dir with original filename', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, true)

    expect(tb.originalFile).toBe('高等数学.pdf')

    const stored = await readFile(
      join(dataRoot, 'textbooks', tb.id, '高等数学.pdf')
    )
    expect(stored.equals(PDF_BYTES)).toBe(true)
  })

  it('create without originalSourcePath records empty originalFile', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    expect(tb.originalFile).toBe('')
  })

  it('readOriginal returns the original bytes and display file name', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, true)

    const result = await store.readOriginal(tb.id, WORLD_ID)
    expect(result).not.toBeNull()
    expect(result!.data.equals(PDF_BYTES)).toBe(true)
    expect(result!.fileName).toBe('高等数学.pdf')
  })

  it('readOriginal returns null when the textbook has no original', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    expect(await store.readOriginal(tb.id, WORLD_ID)).toBeNull()
  })

  it('readOriginal returns null for a nonexistent textbook', async () => {
    const store = new TextbookStore(dataRoot)
    expect(await store.readOriginal('tb_nope', WORLD_ID)).toBeNull()
  })

  it('textbook.json round-trips through get() with originalFile preserved', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, true)
    const loaded = await store.get(tb.id, WORLD_ID)
    expect(loaded?.originalFile).toBe('高等数学.pdf')
  })
})

describe('TextbookStore mutations', () => {
  it('updateContent rewrites the content file and record', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    const updated = await store.updateContent(tb.id, WORLD_ID, '# 新内容')
    expect(updated?.content).toBe('# 新内容')
    expect(await store.getContent(tb.id, WORLD_ID)).toBe('# 新内容')
  })

  it('update changes title/author/description/rating', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    const updated = await store.update(tb.id, WORLD_ID, { title: '新标题', author: '新作者', rating: 5 })
    expect(updated?.title).toBe('新标题')
    expect(updated?.author).toBe('新作者')
    expect(updated?.rating).toBe(5)
  })

  it('update/updateContent/updateProgress return null for a missing textbook', async () => {
    const store = new TextbookStore(dataRoot)
    expect(await store.update('tb_missing', WORLD_ID, { title: 'x' })).toBeNull()
    expect(await store.updateContent('tb_missing', WORLD_ID, 'x')).toBeNull()
    expect(await store.updateProgress('tb_missing', WORLD_ID, { currentPage: 1 })).toBeNull()
  })

  it('updateProgress persists reading progress', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    await store.updateProgress(tb.id, WORLD_ID, { currentPage: 3, totalPages: 10, readingPercentage: 0.3, lastPosition: 'chapter-2' })
    const got = await store.get(tb.id, WORLD_ID)
    expect(got?.progress.currentPage).toBe(3)
    expect(got?.progress.totalPages).toBe(10)
    expect(got?.progress.readingPercentage).toBe(0.3)
    expect(got?.progress.lastPosition).toBe('chapter-2')
  })

  it('softDelete marks isDeleted and hides the textbook from list; delete removes it entirely', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, true)
    expect(await store.softDelete(tb.id, WORLD_ID)).toBe(true)
    expect(await store.list(WORLD_ID)).toHaveLength(0)
    expect((await store.get(tb.id, WORLD_ID))?.isDeleted).toBe(true)
    expect(await store.delete(tb.id, WORLD_ID)).toBe(true)
    expect(await store.get(tb.id, WORLD_ID)).toBeNull()
  })

  it('getContent falls back to the record content when the file is missing', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    await rm(textbookContentPath(dataRoot, tb.id, WORLD_ID), { force: true })
    expect(await store.getContent(tb.id, WORLD_ID)).toBe(tb.content)
  })
})
