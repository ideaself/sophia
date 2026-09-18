import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'

import { TextbookStore } from '../../../src/main/storage/textbook-store'
import { textbookContentPath, textbookDir, textbookPath } from '../../../src/main/storage/app-data'

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

    const result = await store.readOriginal(tb.id)
    expect(result).not.toBeNull()
    expect(result!.data.equals(PDF_BYTES)).toBe(true)
    expect(result!.fileName).toBe('高等数学.pdf')
  })

  it('readOriginal returns null when the textbook has no original', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    expect(await store.readOriginal(tb.id)).toBeNull()
  })

  it('readOriginal returns null for a nonexistent textbook', async () => {
    const store = new TextbookStore(dataRoot)
    expect(await store.readOriginal('tb_nope')).toBeNull()
  })

  it('textbook.json round-trips through get() with originalFile preserved', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, true)
    const loaded = await store.get(tb.id)
    expect(loaded?.originalFile).toBe('高等数学.pdf')
  })

  it('falls back to source.pdf when the provided name sanitizes to empty', async () => {
    const sourcePath = join(importDir, '原稿.pdf')
    await writeFile(sourcePath, PDF_BYTES)
    const store = new TextbookStore(dataRoot)
    const tb = await store.create({
      title: '空白文件名',
      format: 'pdf',
      sourceFile: '   ',
      originalSourcePath: sourcePath
    })

    expect(tb.originalFile).toBe('source.pdf')
    expect(
      (await readFile(join(textbookDir(dataRoot, tb.id), 'source.pdf'))).equals(PDF_BYTES)
    ).toBe(true)
  })

  it('falls back to source.epub for epub imports', async () => {
    const sourcePath = join(importDir, 'book.epub')
    await writeFile(sourcePath, Buffer.from('EPUB'))
    const store = new TextbookStore(dataRoot)
    const tb = await store.create({
      title: '电子书',
      format: 'epub',
      sourceFile: ' ',
      originalSourcePath: sourcePath
    })

    expect(tb.originalFile).toBe('source.epub')
  })

  it('readOriginal uses originalFile when the record has no sourceFile', async () => {
    const sourcePath = join(importDir, '手稿.pdf')
    await writeFile(sourcePath, PDF_BYTES)
    const store = new TextbookStore(dataRoot)
    const tb = await store.create({ title: '无 sourceFile', format: 'pdf', originalSourcePath: sourcePath })

    expect(tb.sourceFile).toBe('')
    expect(tb.originalFile).toBe('手稿.pdf')
    const result = await store.readOriginal(tb.id)
    expect(result?.fileName).toBe('手稿.pdf')
  })

  it('creates a textbook without content or original file', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await store.create({ title: '空教材', format: 'markdown' })

    expect(tb.content).toBe('')
    await expect(store.getContent(tb.id)).resolves.toBe('')
  })

  it('rejects an import path without a usable basename', async () => {
    const store = new TextbookStore(dataRoot)

    // A directory path (trailing separator) yields an empty basename and then
    // fails copying the "original file" — the metadata step still runs.
    await expect(
      store.create({
        title: '无文件名',
        format: 'pdf',
        originalSourcePath: importDir + sep
      })
    ).rejects.toThrow()
  })
})

describe('TextbookStore mutations', () => {
  it('updateContent rewrites the content file and record', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    const updated = await store.updateContent(tb.id, '# 新内容')
    expect(updated?.content).toBe('# 新内容')
    expect(await store.getContent(tb.id)).toBe('# 新内容')
  })

  it('update changes title/author/description/rating', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    const updated = await store.update(tb.id, { title: '新标题', author: '新作者', rating: 5 })
    expect(updated?.title).toBe('新标题')
    expect(updated?.author).toBe('新作者')
    expect(updated?.rating).toBe(5)
  })

  it('update/updateContent/updateProgress return null for a missing textbook', async () => {
    const store = new TextbookStore(dataRoot)
    expect(await store.update('tb_missing', { title: 'x' })).toBeNull()
    expect(await store.updateContent('tb_missing', 'x')).toBeNull()
    expect(await store.updateProgress('tb_missing', { currentPage: 1 })).toBeNull()
  })

  it('updateProgress persists reading progress', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    await store.updateProgress(tb.id, { currentPage: 3, totalPages: 10, readingPercentage: 0.3, lastPosition: 'chapter-2' })
    const got = await store.get(tb.id)
    expect(got?.progress.currentPage).toBe(3)
    expect(got?.progress.totalPages).toBe(10)
    expect(got?.progress.readingPercentage).toBe(0.3)
    expect(got?.progress.lastPosition).toBe('chapter-2')
  })

  it('updateProgress leaves unspecified fields untouched', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    await store.updateProgress(tb.id, { currentPage: 3 })
    await store.updateProgress(tb.id, {})

    const got = await store.get(tb.id)
    expect(got?.progress.currentPage).toBe(3)
    expect(got?.progress.totalPages).toBeNull()
    expect(got?.progress.readingPercentage).toBe(0)
    expect(got?.progress.lastPosition).toBe('')
  })

  it('softDelete marks isDeleted and hides the textbook from list; delete removes it entirely', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, true)
    expect(await store.softDelete(tb.id)).toBe(true)
    expect(await store.list()).toHaveLength(0)
    expect((await store.get(tb.id))?.isDeleted).toBe(true)
    expect(await store.delete(tb.id)).toBe(true)
    expect(await store.get(tb.id)).toBeNull()
  })

  it('getContent falls back to the record content when the file is missing', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    await rm(textbookContentPath(dataRoot, tb.id), { force: true })
    expect(await store.getContent(tb.id)).toBe(tb.content)
  })

  it('getContent returns an empty string for a missing textbook', async () => {
    const store = new TextbookStore(dataRoot)
    await expect(store.getContent('tb_missing')).resolves.toBe('')
  })
})

describe('TextbookStore — read failures and legacy originals', () => {
  it('returns an empty list before any textbook exists', async () => {
    const store = new TextbookStore(dataRoot)
    await expect(store.list()).resolves.toEqual([])
  })

  it('sorts the list by most recent update', async () => {
    const store = new TextbookStore(dataRoot)
    const first = await createPdfTextbook(store, false)
    const second = await store.create({
      title: '第二本',
      format: 'markdown',
      content: '# x'
    })

    // Touch the first one so it becomes newer than the second.
    await store.update(first.id, { title: '第一本（改）' })

    const list = await store.list()
    expect(list.map((t) => t.id)).toEqual([first.id, second.id])
  })

  it('rejects records with a schema mismatch and warns for unreadable files', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)

    // Valid JSON, wrong shape → schema mismatch.
    await writeFile(textbookPath(dataRoot, tb.id), JSON.stringify({ id: tb.id }))
    await expect(store.get(tb.id)).resolves.toBeNull()

    // Unreadable path (a directory where the JSON file belongs) → warn + null.
    await rm(textbookPath(dataRoot, tb.id), { force: true })
    await mkdir(textbookPath(dataRoot, tb.id), { recursive: true })
    await expect(store.get(tb.id)).resolves.toBeNull()
  })

  it('update persists description and content together', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)

    const updated = await store.update(tb.id, { description: '简明讲义', content: '# 新正文' })

    expect(updated?.description).toBe('简明讲义')
    expect(await store.getContent(tb.id)).toBe('# 新正文')
    expect((await store.get(tb.id))?.content).toBe('# 新正文')
  })

  it('softDelete returns false for a missing textbook', async () => {
    const store = new TextbookStore(dataRoot)
    await expect(store.softDelete('tb_missing')).resolves.toBe(false)
  })

  it('reads a legacy source.pdf when the stored original name is gone', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, true)
    // Old layout: the original was stored as source.pdf.
    await rm(join(textbookDir(dataRoot, tb.id), tb.originalFile), { force: true })
    await writeFile(join(textbookDir(dataRoot, tb.id), 'source.pdf'), PDF_BYTES)

    const result = await store.readOriginal(tb.id)

    expect(result?.data.equals(PDF_BYTES)).toBe(true)
    expect(result?.fileName).toBe('高等数学.pdf')
  })

  it('reads a legacy source.epub for epub textbooks', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await store.create({
      title: '电子书',
      format: 'epub',
      sourceFile: 'book.epub',
      content: '# x'
    })
    // Simulate a record with an original name that no longer resolves.
    await writeFile(textbookPath(dataRoot, tb.id), JSON.stringify({ ...tb, originalFile: 'ghost.epub' }))
    await writeFile(join(textbookDir(dataRoot, tb.id), 'source.epub'), Buffer.from('EPUB'))

    const result = await store.readOriginal(tb.id)

    expect(result?.data.toString()).toBe('EPUB')
  })

  it('returns null when neither the stored name nor a legacy source exists', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, true)
    await rm(join(textbookDir(dataRoot, tb.id), tb.originalFile), { force: true })

    await expect(store.readOriginal(tb.id)).resolves.toBeNull()
  })
})
