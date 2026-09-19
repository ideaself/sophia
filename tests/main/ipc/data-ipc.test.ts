/**
 * data.ts IPC integration tests.
 *
 * Registers the real handler set against a temp data root (real stores, real
 * files) and invokes the handlers through a captured ipcMain map. electron is
 * mocked: dialogs return scripted results, BrowserWindow is a minimal fake so
 * pdf/screenshot flows can run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

type Handler = (event: unknown, input?: unknown) => Promise<unknown>

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Handler>()
  const showOpenDialog = vi.fn()
  const showSaveDialog = vi.fn()
  const showMessageBox = vi.fn()

  class FakeWebContents {
    send = vi.fn()
    isDestroyed = vi.fn(() => false)
    printToPDF = vi.fn(async () => Buffer.from('%PDF-1.4 fake'))
    capturePage = vi.fn(async () => ({ toPNG: () => Buffer.from('PNG-BYTES') }))
  }

  class FakeBrowserWindow {
    webContents = new FakeWebContents()
    loadURL = vi.fn(async () => {})
    destroy = vi.fn()
    static windows: FakeBrowserWindow[] = []
    static focused: FakeBrowserWindow | null = null
    static getAllWindows(): FakeBrowserWindow[] {
      return FakeBrowserWindow.windows
    }
    static getFocusedWindow(): FakeBrowserWindow | null {
      return FakeBrowserWindow.focused
    }
    constructor(_options?: unknown) {}
  }

  return { handlers, showOpenDialog, showSaveDialog, showMessageBox, FakeBrowserWindow }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      mocks.handlers.set(channel, fn)
    }
  },
  dialog: {
    showOpenDialog: mocks.showOpenDialog,
    showSaveDialog: mocks.showSaveDialog,
    showMessageBox: mocks.showMessageBox
  },
  BrowserWindow: mocks.FakeBrowserWindow
}))

/** Scripted EPUB chapter payloads (the epub parser itself has its own tests). */
const epub = vi.hoisted(() => ({ chapters: [] as unknown[], calls: [] as string[] }))

/** Lets a single extractText call throw a raw (non-Error) value on demand. */
const parsers = vi.hoisted(() => ({ extractTextThrow: null as unknown }))

vi.mock('../../../src/main/parsers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/parsers')>()
  return {
    ...actual,
    extractText: async (path: string) => {
      if (parsers.extractTextThrow !== null) throw parsers.extractTextThrow
      return actual.extractText(path)
    },
    getEpubChapters: async (path: string) => {
      epub.calls.push(path)
      return epub.chapters
    }
  }
})

/** Lets a single atomic write fail on demand (writeback error paths). */
const atomicFail = vi.hoisted(() => ({ paths: [] as string[], rawPaths: [] as string[] }))

vi.mock('../../../src/main/storage/atomic-write', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/main/storage/atomic-write')>()
  return {
    ...actual,
    atomicWriteFile: async (path: string, data: string | Buffer, enc?: BufferEncoding) => {
      if (atomicFail.rawPaths.some((fragment) => path.includes(fragment))) {
        throw 'disk full (raw)'
      }
      if (atomicFail.paths.some((fragment) => path.includes(fragment))) {
        throw new Error('disk full')
      }
      return actual.atomicWriteFile(path, data, enc)
    }
  }
})

/** Lets a single rm() call fail on demand (delete-failure paths live in stores). */
const fsFail = vi.hoisted(() => ({ rmPaths: [] as string[] }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: async (
      path: Parameters<typeof actual.rm>[0],
      options?: Parameters<typeof actual.rm>[1]
    ) => {
      if (fsFail.rmPaths.some((fragment) => String(path).includes(fragment))) {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
      }
      return actual.rm(path, options)
    }
  }
})

const llm = vi.hoisted(() => ({
  chat: vi.fn((_messages: Array<{ role: string; content: string }>) =>
    Promise.resolve({ content: '通用内容' })
  ),
  clients: [] as Array<{ apiKey: string; model: string }>
}))

vi.mock('../../../src/main/llm/deepseek-client', () => ({
  DeepSeekClient: class {
    constructor(apiKey: string, _adapter: unknown, model: string) {
      llm.clients.push({ apiKey, model })
    }
    chat(messages: Array<{ role: string; content: string }>): Promise<{ content: string }> {
      return llm.chat(messages) as Promise<{ content: string }>
    }
  }
}))

import { registerConversationIpc } from '../../../src/main/ipc/data'
import { ConceptStore } from '../../../src/main/learning-memory/concept-store'
import { ProviderStore } from '../../../src/main/storage/provider-store'
import { loadReferenceCompanions } from '../../../src/main/companions/reference-loader'
import {
  artifactsDir,
  companionDir,
  configDir,
  learnerPath,
  palMomentsPath,
  palMomentsPathForTextbook,
  relationPath,
  handoffMetaPath,
  textbookDir,
  textbookPath
} from '../../../src/main/storage/app-data'
import type { SafeStorageAdapter } from '../../../src/main/security/secure-key-store'

const projectsRoot = join(__dirname, '..', '..', '..')
const candidatesDir = join(projectsRoot, 'reference', '角色设定', 'candidates')

const fakeSafeStorage: SafeStorageAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf8')
}

/** Configure an active provider with a stored API key for the pipeline. */
async function withProvider(model = 'deepseek-v4-flash'): Promise<void> {
  const providerStore = new ProviderStore(dataRoot, fakeSafeStorage)
  const provider = await providerStore.create({
    name: 'DeepSeek',
    type: 'deepseek',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-live',
    models: [model],
    selectedModel: model
  })
  await providerStore.update(provider.id, { isActive: true })
}

/** Answer each artifact prompt with plausible, distinctly-marked content. */
function llmByPrompt(): void {
  llm.chat.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
    const sys = messages[0]?.content ?? ''
    if (sys.includes('课堂总结')) return { content: '## 总结\n本节讲了熵。' }
    if (sys.includes('记忆卡片')) return { content: '- 问题：熵是什么？\n- 答案：状态函数' }
    if (sys.includes('课后日记')) return { content: '今天理解了熵的含义。' }
    if (sys.includes('学习进展')) return { content: '理解程度：理解\n建议下一步：练习' }
    if (sys.includes('接力尾巴')) return { content: '上次讲到熵，下次从第二定律继续。' }
    if (sys.includes('告别语')) return { content: '今天很有收获，下次见。' }
    if (sys.includes('画像评估')) return { content: '认知水平：理解' }
    if (sys.includes('教学互动备忘')) return { content: '## 2026-09-16 | 朗道\n讨论了熵。' }
    if (sys.includes('关系状态')) return { content: '关系更亲近了一点。' }
    if (sys.includes('知识蛋')) return { content: '## 学习者讲解了什么\n熵。' }
    if (sys.includes('Mermaid')) return { content: '```mermaid\ngraph TD\nA-->B\n```' }
    if (sys.includes('双人回顾对话')) return { content: '【导师】熵是什么？\n【学习者】状态函数。' }
    if (sys.includes('时间线')) return { content: '- 00:00 引入：熵' }
    if (sys.includes('FAQ')) return { content: '- 问：熵是什么？\n- 答：状态函数' }
    if (sys.includes('翻译')) return { content: '熵是状态函数。' }
    return { content: '通用内容' }
  })
}

/** Minimal single-page PDF with a valid xref table (dependency-free). */
function buildMinimalPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 100 700 Td (${text}) Tj ET`
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

let dataRoot = ''

async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return (await handler({}, input)) as T
}

/** Flush the fire-and-forget work the handlers queue (concepts, artifacts). */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-ipc-'))
  mocks.handlers.clear()
  mocks.showOpenDialog.mockReset()
  mocks.showSaveDialog.mockReset()
  mocks.showMessageBox.mockReset()
  mocks.FakeBrowserWindow.windows = []
  mocks.FakeBrowserWindow.focused = null
  llm.chat.mockReset().mockResolvedValue({ content: '通用内容' })
  llm.clients.length = 0
  parsers.extractTextThrow = null
  atomicFail.paths.length = 0
  atomicFail.rawPaths.length = 0
  fsFail.rmPaths.length = 0

  const providerStore = new ProviderStore(dataRoot, fakeSafeStorage)
  registerConversationIpc(dataRoot, providerStore)
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------

describe('conversation handlers', () => {
  it('creates, reads, lists, renames and deletes a conversation', async () => {
    const conv = await invoke<{ id: string; title: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '物理第一课'
    })
    expect(conv.title).toBe('物理第一课')

    const fetched = await invoke<{ id: string } | null>('conversation:get', {
      conversationId: conv.id
    })
    expect(fetched?.id).toBe(conv.id)

    const list = await invoke<Array<{ id: string }>>('conversation:list')
    expect(list.map((c) => c.id)).toContain(conv.id)

    const renamed = await invoke<{ title: string }>('conversation:update-title', {
      conversationId: conv.id,
      title: '物理第二课'
    })
    expect(renamed.title).toBe('物理第二课')

    expect(await invoke('conversation:delete', { conversationId: conv.id })).toBe(true)
    expect(await invoke('conversation:get', { conversationId: conv.id })).toBeNull()
  })

  it('rejects invalid create input', async () => {
    await expect(invoke('conversation:create', { companionId: 'comp_x' })).rejects.toThrow()
    await expect(
      invoke('conversation:create', { companionId: '../escape', title: 'x' })
    ).rejects.toThrow()
  })

  it('truncates a conversation after a message', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '回退'
    })
    const m1 = await invoke<{ id: string }>('message:send', {
      conversationId: conv.id,
      content: '第一条'
    })
    await invoke('message:send', { conversationId: conv.id, content: '第二条' })
    await invoke('message:send', { conversationId: conv.id, content: '第三条' })

    expect(await invoke('conversation:truncate', { conversationId: conv.id, messageId: m1.id })).toBe(true)
    const msgs = await invoke<Array<{ content: string }>>('message:list', {
      conversationId: conv.id
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('第一条')
  })

  it('ends a class once and is idempotent on a second end', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '下课'
    })

    const first = await invoke<{ success: boolean; pending: boolean }>('conversation:end', {
      conversationId: conv.id,
      classMode: 'standard'
    })
    expect(first).toMatchObject({ success: true, pending: true })

    const second = await invoke<{ success: boolean; pending: boolean }>('conversation:end', {
      conversationId: conv.id
    })
    expect(second).toMatchObject({ success: true, pending: false })

    const missing = await invoke<{ success: boolean }>('conversation:end', {
      conversationId: 'conv_missing'
    })
    expect(missing.success).toBe(false)

    await flush()
  })

  it('rejects unknown artifact types for redo (schema-guarded)', async () => {
    await expect(
      invoke('conversation:redo-artifacts', {
        conversationId: 'conv_1',
        types: ['not_a_type']
      })
    ).rejects.toThrow()
  })
})

describe('message handlers', () => {
  it('sends, lists, searches, edits and deletes messages', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '消息'
    })

    const user = await invoke<{ id: string; role: string }>('message:send', {
      conversationId: conv.id,
      content: '什么是熵？'
    })
    expect(user.role).toBe('user')
    // assistant send also schedules the (debounced) concept update — no
    // provider is configured, so it must resolve without side effects.
    await invoke('message:send', {
      conversationId: conv.id,
      content: '熵是无序度的度量。',
      role: 'assistant'
    })

    const msgs = await invoke<Array<{ id: string }>>('message:list', { conversationId: conv.id })
    expect(msgs).toHaveLength(2)

    const hits = await invoke<{ results: Array<{ message: { id: string } }>; total: number }>(
      'message:search',
      { query: '熵是', limit: 50, offset: 0 }
    )
    expect(hits.results.length).toBeGreaterThanOrEqual(1)

    const updated = await invoke<{ content: string } | null>('message:update', {
      conversationId: conv.id,
      messageId: user.id,
      content: '什么是热力学第二定律？'
    })
    expect(updated?.content).toBe('什么是热力学第二定律？')

    expect(
      await invoke('message:delete', { conversationId: conv.id, messageId: user.id })
    ).toBe(true)
    expect(await invoke<unknown[]>('message:list', { conversationId: conv.id })).toHaveLength(1)

    await flush()
  })

  it('reports false for edits and deletes of unknown messages', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '未知消息'
    })

    expect(
      await invoke('message:update', {
        conversationId: conv.id,
        messageId: 'msg_missing',
        content: '改不存在的消息'
      })
    ).toBeNull()
    expect(
      await invoke('message:delete', { conversationId: conv.id, messageId: 'msg_missing' })
    ).toBe(false)
  })

  it('rejects whitespace-only message content', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '校验'
    })
    await expect(
      invoke('message:send', { conversationId: conv.id, content: '   ' })
    ).rejects.toThrow()
  })

  it('lists concepts for a conversation and globally', async () => {
    await expect(invoke('concepts:list', '')).resolves.toEqual([])
    await expect(invoke('concepts:list', 'conv_none')).resolves.toEqual([])
  })

  it('aggregates today study minutes and the stats overview', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '统计'
    })
    await invoke('message:send', { conversationId: conv.id, content: '问题一' })
    await invoke('message:send', { conversationId: conv.id, content: '问题二', role: 'assistant' })

    const minutes = await invoke<number>('stats:today-study-minutes')
    expect(typeof minutes).toBe('number')

    const overview = await invoke<{ totalMessages: number; week: { messages: number } } | null>(
      'stats:overview'
    )
    expect(overview?.totalMessages).toBe(2)
    expect(overview?.week.messages).toBe(2)

    const due = await invoke<{ due: number; total: number }>('stats:due-flashcards')
    expect(due).toEqual({ due: 0, total: 0 })

    await flush()
  })
})

describe('dialog + file handlers', () => {
  it('registers picked files from the dialogs and writes through them', async () => {
    const target = join(dataRoot, '导出.md')
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })

    const saved = await invoke<{ canceled: boolean; filePath: string }>('dialog:saveFile', {
      defaultPath: '导出.md'
    })
    expect(saved.filePath).toBe(target)

    // Writing is allowed now that the path came from the dialog.
    expect(await invoke('file:writeText', { filePath: target, content: '# 你好' })).toEqual({
      success: true
    })
    expect(await readFile(target, 'utf-8')).toBe('# 你好')
  })

  it('rejects writes to paths that never came from a dialog', async () => {
    await expect(
      invoke('file:writeText', { filePath: join(dataRoot, '逃逸.md'), content: 'x' })
    ).rejects.toThrow(/save dialog/)
  })

  it('collects open-dialog picks and answers confirm dialogs', async () => {
    const picked = join(dataRoot, '教材.md')
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [picked] })
    const result = await invoke<{ canceled: boolean; filePaths: string[] }>('dialog:openFile', {})
    expect(result.filePaths).toEqual([picked])

    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 })
    expect(await invoke('dialog:confirm', { message: '下课？' })).toBe(true)
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 })
    expect(await invoke('dialog:confirm', { message: '下课？' })).toBe(false)
  })

  it('exports a PDF through a hidden window and captures a screenshot', async () => {
    const pdfPath = join(dataRoot, '课堂笔记.pdf')
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: pdfPath })
    await invoke('dialog:saveFile', {})

    expect(await invoke('pdf:export', { html: '<h1>笔记</h1>', filePath: pdfPath })).toEqual({
      success: true
    })
    expect(await readFile(pdfPath)).toEqual(Buffer.from('%PDF-1.4 fake'))

    const pngPath = join(dataRoot, '课堂.png')
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: pngPath })
    await invoke('dialog:saveFile', {})

    mocks.FakeBrowserWindow.focused = new mocks.FakeBrowserWindow()
    expect(await invoke('screenshot:capture', { filePath: pngPath })).toEqual({ success: true })
    expect(await readFile(pngPath)).toEqual(Buffer.from('PNG-BYTES'))

    // Without any window the capture must fail loudly.
    mocks.FakeBrowserWindow.focused = null
    mocks.FakeBrowserWindow.windows = []
    await expect(invoke('screenshot:capture', { filePath: pngPath })).rejects.toThrow(
      /No window/
    )
  })

  it('exports a backup zip and validates restore input', async () => {
    // The data root is fresh per test: give it a real file so the backup has
    // deterministic content (relying on the in-progress zip itself is a race).
    await writeFile(join(dataRoot, 'learner.md'), '# 学习者档案', 'utf-8')
    const zipPath = join(dataRoot, '备份.zip')
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: zipPath })
    await invoke('dialog:saveFile', {})

    const exported = await invoke<{ fileCount: number }>('data:export-backup', {
      filePath: zipPath
    })
    expect(exported.fileCount).toBeGreaterThan(0)
    expect(existsSync(zipPath)).toBe(true)

    // A path that never came from a dialog is refused outright.
    const rejected = await invoke<{ success: boolean; error?: string }>(
      'data:restore-backup',
      join(dataRoot, '没选过.zip')
    )
    expect(rejected.success).toBe(false)
    expect(rejected.error).toMatch(/文件选择/)

    // The exported zip is picked, but this bare data root has no config/
    // companions dirs, so the restore validation still refuses it.
    const invalid = await invoke<{ success: boolean; error?: string }>('data:restore-backup', zipPath)
    expect(invalid.success).toBe(false)
    expect(invalid.error).toBeTruthy()
  })
})

describe('textbook handlers', () => {
  it('archives an unknown textbook under its id and reports the failed delete', async () => {
    // Delete is idempotent (true even when nothing matched); the point here is
    // the archive step falling back to the raw id as the title.
    expect(await invoke('textbook:delete', { textbookId: 'tb_missing' })).toBe(true)
  })

  it('creates a textbook, updates it, tracks progress and deletes it', async () => {
    const tb = await invoke<{ id: string; title: string; progress: { currentPage: number } }>(
      'textbook:create',
      {
        title: '热力学讲义',
        author: '朗道',
        format: 'markdown',
        content: '# 第一章 温度\n\n温度是分子平均动能的度量。\n\n# 第二章 熵\n\n熵是状态函数。'
      }
    )
    expect(tb.title).toBe('热力学讲义')

    const fetched = await invoke<{ id: string } | null>('textbook:get', { textbookId: tb.id })
    expect(fetched?.id).toBe(tb.id)

    await expect(invoke<unknown[]>('textbook:list')).resolves.toHaveLength(1)

    const updated = await invoke<{ title: string }>('textbook:update', {
      textbookId: tb.id,
      title: '热力学讲义（修订）',
      rating: 4
    })
    expect(updated.title).toBe('热力学讲义（修订）')

    const withProgress = await invoke<{ progress: { readingPercentage: number } }>(
      'textbook:update-progress',
      { textbookId: tb.id, currentPage: 2, totalPages: 4, readingPercentage: 0.5 }
    )
    expect(withProgress.progress.readingPercentage).toBe(0.5)

    expect(await invoke('textbook:delete', { textbookId: tb.id })).toBe(true)
    expect(await invoke('textbook:get', { textbookId: tb.id })).toBeNull()
  })

  it('refuses pdf/epub sources that were not selected through the dialog', async () => {
    await expect(
      invoke('textbook:create', {
        title: '外部 PDF',
        format: 'pdf',
        sourceFile: join(dataRoot, 'x.pdf')
      })
    ).rejects.toThrow(/file dialog/)
  })

  it('looks up citation excerpts and returns null for unknown chapters', async () => {
    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '讲义',
      format: 'markdown',
      content: '# 第一章 温度\n\n温度是分子平均动能的度量。\n\n# 第二章 熵\n\n熵是状态函数，永不减少。'
    })

    const hit = await invoke<{ chapter: string; excerpt: string } | null>(
      'textbook:search-excerpt',
      { textbookId: tb.id, chapter: '熵' }
    )
    expect(hit?.excerpt).toMatch(/状态函数/)

    const miss = await invoke<unknown>('textbook:search-excerpt', {
      textbookId: tb.id,
      chapter: '不存在的章节'
    })
    expect(miss).toBeNull()

    // No provider key configured → translation is unavailable, not an error.
    await expect(
      invoke('textbook:translate-excerpt', { textbookId: tb.id, chapter: '熵' })
    ).resolves.toBeNull()
  })

  it('returns null for missing originals and rejects epub reads without one', async () => {
    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '无原件',
      format: 'markdown',
      content: '# 一'
    })

    await expect(invoke('textbook:read-original', { textbookId: tb.id })).resolves.toBeNull()
    await expect(invoke('epub:read-chapters', { textbookId: tb.id })).rejects.toThrow(
      /no original/
    )
    await expect(invoke('epub:reparse-content', { textbookId: tb.id })).rejects.toThrow(
      /no original/
    )
  })
})

describe('reading note + artifact handlers', () => {
  it('creates, lists, updates and deletes reading notes', async () => {
    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '批注本',
      format: 'markdown',
      content: '# 一'
    })

    const note = await invoke<{ id: string; content: string }>('reading-note:create', {
      textbookId: tb.id,
      content: '重点：熵不减',
      position: '12',
      chapter: '第二章',
      type: 'highlight'
    })
    expect(note.content).toBe('重点：熵不减')

    const notes = await invoke<Array<{ id: string }>>('reading-note:list', { textbookId: tb.id })
    expect(notes).toHaveLength(1)

    const renamed = await invoke<{ id: string; readerNote?: string } | null>('reading-note:update', {
      noteId: note.id,
      textbookId: tb.id,
      readerNote: '复习用'
    })
    expect(renamed?.readerNote).toBe('复习用')
    const afterUpdate = await invoke<Array<{ id: string; readerNote?: string }>>(
      'reading-note:list',
      { textbookId: tb.id }
    )
    expect(afterUpdate[0]?.readerNote).toBe('复习用')

    expect(await invoke('reading-note:delete', { noteId: note.id, textbookId: tb.id })).toBe(true)
    await expect(invoke<unknown[]>('reading-note:list', { textbookId: tb.id })).resolves.toHaveLength(0)
  })

  it('creates, edits and lists artifacts', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '产物'
    })

    const artifact = await invoke<{ id: string; content: string }>('artifact:create', {
      conversationId: conv.id,
      type: 'lesson_summary',
      content: '## 总结\n本节讲了熵。'
    })

    const fetched = await invoke<{ id: string } | null>('artifact:get', {
      artifactId: artifact.id,
      conversationId: conv.id
    })
    expect(fetched?.id).toBe(artifact.id)

    const updated = await invoke<{ content: string }>('artifact:update', {
      artifactId: artifact.id,
      conversationId: conv.id,
      content: '## 总结\n本节讲了热力学第二定律。'
    })
    expect(updated.content).toMatch(/第二定律/)

    const list = await invoke<Array<{ id: string }>>('artifact:list', { conversationId: conv.id })
    expect(list).toHaveLength(1)
  })

  it('deletes specific flashcard cards and persists SRS state + favorites', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '卡片'
    })
    const artifact = await invoke<{ id: string }>('artifact:create', {
      conversationId: conv.id,
      type: 'flashcards',
      content: '- 问题：什么是熵？\n- 答案：无序度的度量\n\n- 问题：什么是焓？\n- 答案：等压热效应\n'
    })

    const deleted = await invoke<{ success: boolean; deleted: number }>('flashcard:delete-cards', {
      cards: [{ conversationId: conv.id, artifactId: artifact.id, cardIndex: 1 }]
    })
    expect(deleted).toEqual({ success: true, deleted: 1 })

    const remaining = await invoke<{ content: string } | null>('artifact:get', {
      artifactId: artifact.id,
      conversationId: conv.id
    })
    expect(remaining?.content).toContain('熵')
    expect(remaining?.content).not.toContain('焓')

    await expect(invoke('flashcard:get-srs-state')).resolves.toEqual({})
    expect(
      await invoke('flashcard:save-srs-state', { 'card_1': { nextReview: 123 } })
    ).toEqual({ success: true })
    await expect(invoke('flashcard:get-srs-state')).resolves.toEqual({
      'card_1': { nextReview: 123 }
    })

    await expect(invoke('flashcard:get-favorites')).resolves.toEqual([])
    expect(await invoke('flashcard:save-favorites', ['card_1', 'card_2'])).toEqual({
      success: true
    })
    await expect(invoke('flashcard:get-favorites')).resolves.toEqual(['card_1', 'card_2'])
  })

  it('lists diary months and reads an empty month', async () => {
    await invoke('diary:list-months', {})
    const month = await invoke<string | null>('diary:get-month', { month: '2026-09' })
    expect(month === null || month === '').toBe(true)
  })
})

// ---------------------------------------------------------------
// LLM-dependent flows (DeepSeekClient is mocked)
// ---------------------------------------------------------------

describe('artifact pipeline end-to-end', () => {
  it('generates artifacts and writes back learner/diary/handoff state', { timeout: 45_000 }, async () => {
    await withProvider()
    await loadReferenceCompanions({ candidatesDir, companionDir: companionDir(dataRoot) })
    llmByPrompt()

    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '讲义',
      format: 'markdown',
      content: '# 第一章 熵\n\n熵是状态函数。'
    })
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      textbookId: tb.id,
      title: '下课流水线'
    })
    await invoke('message:send', { conversationId: conv.id, content: '熵是什么？' })
    await invoke('message:send', { conversationId: conv.id, content: '状态函数。', role: 'assistant' })

    const end = await invoke<{ success: boolean; pending: boolean }>('conversation:end', {
      conversationId: conv.id,
      classMode: 'feynman'
    })
    expect(end).toMatchObject({ success: true, pending: true })

    // A window is open, so the readiness notification reaches its webContents.
    const win = new mocks.FakeBrowserWindow()
    mocks.FakeBrowserWindow.windows = [win]

    // The background queue persists every regular artifact type. Wait for the
    // required types themselves (not just a count): 15 unrelated writes can
    // finish in any order on a loaded machine.
    const requiredTypes = [
      'lesson_summary',
      'flashcards',
      'diary',
      'progress',
      'handoff_tail',
      'feynman_note',
      'lesson_timeline',
      'lesson_faq'
    ]
    await vi.waitFor(
      async () => {
        const list = await invoke<Array<{ type: string }>>('artifact:list', {
          conversationId: conv.id
        })
        expect(list.length).toBeGreaterThanOrEqual(10)
        expect(list.map((a) => a.type)).toEqual(expect.arrayContaining(requiredTypes))
      },
      { timeout: 20_000, interval: 50 }
    )
    const types = (
      await invoke<Array<{ type: string }>>('artifact:list', { conversationId: conv.id })
    ).map((a) => a.type)
    expect(types).toEqual(expect.arrayContaining(requiredTypes))

    // Diary writeback (monthly file) is the pipeline's LAST step: waiting for
    // it also guarantees the earlier writebacks below are in place.
    await vi.waitFor(
      async () => {
        const months = await invoke<string[]>('diary:list-months', {})
        expect(months).toHaveLength(1)
      },
      { timeout: 20_000, interval: 50 }
    )
    const months = await invoke<string[]>('diary:list-months', {})
    expect(await invoke<string>('diary:get-month', { month: months[0] })).toContain(
      '今天理解了熵'
    )

    // Learner profile / pal moments / relation / handoff meta writebacks.
    expect(await readFile(learnerPath(dataRoot), 'utf-8')).toContain('认知水平')
    expect(await readFile(palMomentsPathForTextbook(dataRoot, tb.id), 'utf-8')).toContain('讨论了熵')
    expect(await readFile(relationPath(dataRoot, 'comp_landau'), 'utf-8')).toContain('更亲近')
    const meta = JSON.parse(await readFile(handoffMetaPath(dataRoot), 'utf-8')) as Record<
      string,
      { prevConvId: string; companionName: string }
    >
    expect(meta.comp_landau.prevConvId).toBe(conv.id)
    expect(meta.comp_landau.companionName).toBe('朗道')

    // Progress artifact content is written back to the textbook.
    const refreshed = await invoke<{ progress: { lastPosition: string } }>('textbook:get', {
      textbookId: tb.id
    })
    expect(refreshed.progress.lastPosition).toContain('理解程度')

    // The renderer was told the artifacts are ready.
    expect(win.webContents.send).toHaveBeenCalledWith(
      'artifacts:generated',
      expect.objectContaining({ conversationId: conv.id })
    )
  })

  it('reports background pipeline crashes to the renderer without wedging the queue', { timeout: 30_000 }, async () => {
    await withProvider()
    llmByPrompt()
    const win = new mocks.FakeBrowserWindow()
    mocks.FakeBrowserWindow.windows = [win]

    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '崩溃'
    })
    await invoke('message:send', { conversationId: conv.id, content: '熵是什么？' })
    await invoke('message:send', { conversationId: conv.id, content: '状态函数。', role: 'assistant' })
    // A file where the artifacts directory belongs → persisting throws.
    await writeFile(artifactsDir(dataRoot, conv.id), 'not a directory')

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await invoke('conversation:end', { conversationId: conv.id })

      await vi.waitFor(
        () =>
          expect(error).toHaveBeenCalledWith(
            expect.stringContaining('Background artifact generation error'),
            expect.anything()
          ),
        { timeout: 10_000, interval: 50 }
      )
      const payload = win.webContents.send.mock.calls.find(
        (call) => call[0] === 'artifacts:generated'
      )?.[1] as { artifacts: number; error?: string } | undefined
      expect(payload?.artifacts).toBe(0)
      expect(payload?.error).toBeTruthy()
    } finally {
      error.mockRestore()
    }
  })

  it('queues artifact work without a provider and reports no failures', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '无钥匙'
    })
    const end = await invoke<{ success: boolean }>('conversation:end', { conversationId: conv.id })
    expect(end.success).toBe(true)

    await flush()
    expect(llm.chat).not.toHaveBeenCalled()
    await expect(
      invoke<unknown[]>('artifact:list', { conversationId: conv.id })
    ).resolves.toEqual([])
  })

  it('re-runs only the requested artifact types on redo', async () => {
    await withProvider()
    llmByPrompt()
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '补做'
    })

    const result = await invoke<{ success: boolean; artifacts: number; types: string[] }>(
      'conversation:redo-artifacts',
      { conversationId: conv.id, types: ['lesson_summary', 'lesson_faq'] }
    )

    expect(result).toMatchObject({ success: true, artifacts: 2 })
    const list = await invoke<Array<{ type: string }>>('artifact:list', { conversationId: conv.id })
    expect(list.map((a) => a.type).sort()).toEqual(['lesson_faq', 'lesson_summary'])
  })
})

describe('provider-powered textbook and AI helpers', () => {
  it('translates a citation excerpt through the active provider', async () => {
    await withProvider()
    llmByPrompt()
    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '讲义',
      format: 'markdown',
      content: '# 第二章 熵\n\n熵是状态函数，永不减少。'
    })

    const result = await invoke<{ chapter: string; excerpt: string; translation: string }>(
      'textbook:translate-excerpt',
      { textbookId: tb.id, chapter: '熵' }
    )

    expect(result.translation).toBe('熵是状态函数。')
    expect(result.excerpt).toContain('永不减少')
    expect(llm.clients[0]?.apiKey).toBe('sk-live')
  })

  it('returns null for missing excerpts or unknown chapters', async () => {
    await withProvider()
    await expect(
      invoke('textbook:translate-excerpt', { textbookId: 'tb_missing', chapter: '熵' })
    ).resolves.toBeNull()

    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '讲义',
      format: 'markdown',
      content: '# 一\n\n内容'
    })
    await expect(
      invoke('textbook:translate-excerpt', { textbookId: tb.id, chapter: '不存在' })
    ).resolves.toBeNull()
  })
})

describe('textbook import through the file dialog', () => {
  it('parses a picked PDF into textbook content', async () => {
    const pdfPath = join(dataRoot, 'thermo.pdf')
    await writeFile(pdfPath, buildMinimalPdf('Hello Thermaldynamics'))
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [pdfPath] })
    await invoke('dialog:openFile', {})

    const tb = await invoke<{ id: string; content: string; originalFile: string }>(
      'textbook:create',
      { title: '热力学', format: 'pdf', sourceFile: pdfPath }
    )

    expect(tb.content).toContain('Hello Thermaldynamics')
    expect(tb.originalFile).toBeTruthy()
    // The original is readable for the reader views.
    const original = await invoke<{ data: Uint8Array; fileName: string } | null>(
      'textbook:read-original',
      { textbookId: tb.id }
    )
    expect(original?.fileName).toContain('thermo')
  })

  it('rejects a corrupt PDF with a parse error', async () => {
    const badPath = join(dataRoot, 'broken.pdf')
    await writeFile(badPath, 'this is not a pdf')
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [badPath] })
    await invoke('dialog:openFile', {})

    await expect(
      invoke('textbook:create', { title: '坏文件', format: 'pdf', sourceFile: badPath })
    ).rejects.toThrow(/Failed to parse PDF file/)
  })
})

describe('backup round-trip', () => {
  it('exports a complete data root and restores it', async () => {
    await withProvider()
    await loadReferenceCompanions({ candidatesDir, companionDir: companionDir(dataRoot) })

    const zipPath = join(await mkdtemp(join(tmpdir(), 'sophia-backup-')), 'backup.zip')
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: zipPath })
    await invoke('dialog:saveFile', {})

    const exported = await invoke<{ fileCount: number }>('data:export-backup', {
      filePath: zipPath
    })
    expect(exported.fileCount).toBeGreaterThan(0)

    // Drop the config directory, then restore it from the backup.
    await rm(join(dataRoot, 'config'), { recursive: true, force: true })
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [zipPath] })
    await invoke('dialog:openFile', {})

    const restored = await invoke<{ success: boolean; error?: string }>('data:restore-backup', zipPath)
    expect(restored.success).toBe(true)
    expect(existsSync(join(dataRoot, 'config', 'providers.json'))).toBe(true)
  })
})

describe('save-dialog guards', () => {
  it('refuses pdf export, screenshot and backup exports without a picked path', async () => {
    const never = join(dataRoot, '未选过.bin')
    await expect(invoke('pdf:export', { html: '<p>x</p>', filePath: never })).rejects.toThrow(
      /save dialog/
    )
    await expect(invoke('screenshot:capture', { filePath: never })).rejects.toThrow(/save dialog/)
    await expect(invoke('data:export-backup', { filePath: never })).rejects.toThrow(/save dialog/)
  })
})

describe('artifact failure paths', () => {
  it('reports failed types and survives every writeback target being unwritable', async () => {
    await withProvider()
    llmByPrompt()
    const base = llm.chat.getMockImplementation()!
    llm.chat.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      if ((messages[0]?.content ?? '').includes('时间线')) throw new Error('llm down')
      return base(messages)
    })

    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      textbookId: 'tb_missing',
      title: '写入失败'
    })
    await invoke('message:send', { conversationId: conv.id, content: '熵是什么？' })
    await invoke('message:send', { conversationId: conv.id, content: '状态函数。', role: 'assistant' })

    // Directories in place of every writeback target file.
    const month = new Date().toISOString().slice(0, 7)
    await mkdir(learnerPath(dataRoot), { recursive: true })
    await mkdir(palMomentsPathForTextbook(dataRoot, 'tb_missing'), { recursive: true })
    await mkdir(relationPath(dataRoot, 'comp_landau'), { recursive: true })
    await mkdir(handoffMetaPath(dataRoot), { recursive: true })
    await mkdir(join(dataRoot, 'diary', `${month}.md`), { recursive: true })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await invoke<{ success: boolean; failures: string[] }>(
        'conversation:redo-artifacts',
        {
          conversationId: conv.id,
          types: [
            'learner_profile',
            'pal_moments',
            'relation',
            'handoff_tail',
            'diary',
            'lesson_timeline',
            'lesson_summary'
          ]
        }
      )

      expect(result.success).toBe(true)
      expect(result.failures).toEqual(['lesson_timeline'])
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Artifact generation failures'),
        expect.anything()
      )
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write learner profile'),
        expect.anything()
      )
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write pal moments'),
        expect.anything()
      )
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write relation state'),
        expect.anything()
      )
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write handoff meta'),
        expect.anything()
      )
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to append diary'),
        expect.anything()
      )
    } finally {
      warn.mockRestore()
    }

    // The successful types still landed.
    const list = await invoke<Array<{ type: string }>>('artifact:list', {
      conversationId: conv.id
    })
    expect(list.map((a) => a.type)).toEqual(
      expect.arrayContaining(['lesson_summary', 'handoff_tail', 'diary'])
    )
  })
})

describe('concept updates after assistant messages', () => {
  it('stores extracted concepts and broadcasts the update', { timeout: 30_000 }, async () => {
    await withProvider()
    llm.chat.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      if ((messages[0]?.content ?? '').includes('学习分析助手')) {
        return { content: JSON.stringify([{ name: '熵', performance: 'correct' }]) }
      }
      return { content: '通用内容' }
    })
    const win = new mocks.FakeBrowserWindow()
    mocks.FakeBrowserWindow.windows = [win]

    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '概念'
    })
    await invoke('message:send', { conversationId: conv.id, content: '熵是什么？' })
    await invoke('message:send', { conversationId: conv.id, content: '熵是状态函数。', role: 'assistant' })

    await vi.waitFor(
      async () => {
        const concepts = await invoke<
          Array<{ name: string; attemptCount: number; correctCount: number; mastery: number }>
        >('concepts:list', conv.id)
        expect(concepts).toHaveLength(1)
        expect(concepts[0]).toMatchObject({
          name: '熵',
          attemptCount: 1,
          correctCount: 1
        })
        expect(concepts[0].mastery).toBeGreaterThan(0)
      },
      { timeout: 10_000, interval: 50 }
    )
    expect(win.webContents.send).toHaveBeenCalledWith('concepts:updated', {
      conversationId: conv.id
    })

    // A second assistant message right after is debounced (no new extraction).
    await invoke('message:send', { conversationId: conv.id, content: '补充一句。', role: 'assistant' })
    await flush()
    const extractCalls = llm.chat.mock.calls.filter((call) =>
      String(call[0]?.[0]?.content ?? '').includes('学习分析助手')
    )
    expect(extractCalls).toHaveLength(1)
  })

  it('skips extraction without a Q&A pair or without a stored key', async () => {
    await withProvider()

    // Assistant-only conversation: no user message to pair with.
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '仅导师'
    })
    await invoke('message:send', { conversationId: conv.id, content: '先看这个。', role: 'assistant' })
    await flush()
    expect(llm.chat).not.toHaveBeenCalled()

    // Active provider whose key file is gone (fresh conversation → no debounce).
    const providerStore = new ProviderStore(dataRoot, fakeSafeStorage)
    const active = await providerStore.getActive()
    await rm(join(configDir(dataRoot), `${active!.id}.key.enc`), { force: true })
    const keystoreless = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '无钥匙'
    })
    await invoke('message:send', { conversationId: keystoreless.id, content: '熵是什么？' })
    await invoke('message:send', {
      conversationId: keystoreless.id,
      content: '状态函数。',
      role: 'assistant'
    })
    await flush()
    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('keeps the class running when the concept store fails', { timeout: 30_000 }, async () => {
    await withProvider()
    llm.chat.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      if ((messages[0]?.content ?? '').includes('学习分析助手')) {
        return { content: JSON.stringify([{ name: '热力学', performance: 'partial' }]) }
      }
      return { content: '通用内容' }
    })
    // A directory where the concept store expects its JSON file.
    await mkdir(join(dataRoot, 'concepts.json'), { recursive: true })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const conv = await invoke<{ id: string }>('conversation:create', {
        companionId: 'comp_landau',
        title: '存储失败'
      })
      await invoke('message:send', { conversationId: conv.id, content: '问' })
      await invoke('message:send', { conversationId: conv.id, content: '答', role: 'assistant' })

      await vi.waitFor(
        () =>
          expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('概念更新失败'),
            expect.anything()
          ),
        { timeout: 10_000, interval: 50 }
      )
    } finally {
      warn.mockRestore()
    }
  })
})

describe('flashcard card cleanup', () => {
  it('skips missing artifacts and untouched cards, and empties fully deleted ones', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '卡片边界'
    })
    const artifact = await invoke<{ id: string }>('artifact:create', {
      conversationId: conv.id,
      type: 'flashcards',
      content: '- 问题：a\n- 答案：b\n'
    })

    // Unknown artifact → nothing to do.
    expect(
      await invoke('flashcard:delete-cards', {
        cards: [{ conversationId: conv.id, artifactId: 'art_missing', cardIndex: 0 }]
      })
    ).toEqual({ success: true, deleted: 0 })

    // Out-of-range index → no card removed.
    expect(
      await invoke('flashcard:delete-cards', {
        cards: [{ conversationId: conv.id, artifactId: artifact.id, cardIndex: 9 }]
      })
    ).toEqual({ success: true, deleted: 0 })

    // Deleting the only card clears the artifact content instead of deleting it.
    expect(
      await invoke('flashcard:delete-cards', {
        cards: [{ conversationId: conv.id, artifactId: artifact.id, cardIndex: 0 }]
      })
    ).toEqual({ success: true, deleted: 1 })
    const cleared = await invoke<{ content: string } | null>('artifact:get', {
      artifactId: artifact.id,
      conversationId: conv.id
    })
    expect(cleared?.content ?? '').toBe('')
  })
})

describe('stats: due flashcards', () => {
  it('counts cards from ended conversations only', async () => {
    const ended = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '已下课'
    })
    await invoke('artifact:create', {
      conversationId: ended.id,
      type: 'flashcards',
      content: '- 问题：熵\n- 答案：状态函数\n'
    })
    await invoke('conversation:end', { conversationId: ended.id })

    const running = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '进行中'
    })
    await invoke('artifact:create', {
      conversationId: running.id,
      type: 'flashcards',
      content: '- 问题：焓\n- 答案：等压热效应\n'
    })

    const due = await invoke<{ due: number; total: number }>('stats:due-flashcards')
    expect(due).toMatchObject({ due: 1, total: 1 })
  })

  it('tolerates unreadable conversations and skips empty ones', async () => {
    // A conversation with no messages contributes nothing to the study time.
    await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '空会话'
    })

    // A conversation whose artifact listing cannot be read.
    const broken = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '坏会话'
    })
    await invoke('message:send', { conversationId: broken.id, content: '今天学了点东西' })
    await writeFile(artifactsDir(dataRoot, broken.id), 'not a directory')

    const minutes = await invoke<number>('stats:today-study-minutes')
    expect(typeof minutes).toBe('number')

    const overview = await invoke<unknown>('stats:overview')
    expect(overview).toBeTruthy()
  })
})

describe('archive warnings', () => {
  it('keeps deleting when moving items into the archive fails', async () => {
    // A file where the archive directory should be → every archive attempt fails.
    await writeFile(join(dataRoot, 'archive'), 'not a directory')

    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '待删教材',
      format: 'markdown',
      content: '# 第一章\n正文'
    })
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '待删课堂'
    })
    await invoke('message:send', { conversationId: conv.id, content: '消息' })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(invoke('textbook:delete', { textbookId: tb.id })).resolves.toBe(true)
      await expect(invoke('conversation:delete', { conversationId: conv.id })).resolves.toBe(true)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Archive textbook'),
        expect.anything()
      )
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Archive conversation'),
        expect.anything()
      )
    } finally {
      warn.mockRestore()
    }

    await expect(invoke('textbook:get', { textbookId: tb.id })).resolves.toBeNull()
    await expect(invoke('conversation:get', { conversationId: conv.id })).resolves.toBeNull()
  })
})

describe('epub handlers', () => {
  async function withEpubTextbook(): Promise<{ id: string }> {
    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '电子书',
      format: 'markdown',
      content: '# 第一章\n正文'
    })
    const jsonPath = textbookPath(dataRoot, tb.id)
    const meta = JSON.parse(await readFile(jsonPath, 'utf-8')) as Record<string, unknown>
    meta.originalFile = 'book.epub'
    await writeFile(jsonPath, JSON.stringify(meta, null, 2))
    await writeFile(join(textbookDir(dataRoot, tb.id), 'book.epub'), 'fake epub')
    return tb
  }

  it('reads chapters from the original file', async () => {
    epub.calls.length = 0
    epub.chapters = {
      chapters: [{ id: 'c1', title: 't', html: '<p>正文</p>' }],
      title: 'T',
      author: 'A'
    } as never
    const tb = await withEpubTextbook()

    const result = await invoke<{ chapters: Array<{ id: string }>; title: string }>(
      'epub:read-chapters',
      { textbookId: tb.id }
    )

    expect(result.title).toBe('T')
    expect(result.chapters).toHaveLength(1)
    expect(epub.calls[0].endsWith('book.epub')).toBe(true)

    await expect(invoke('epub:read-chapters', { textbookId: 'tb_missing' })).rejects.toThrow(
      /no original file/
    )
  })

  it('reparses content and rejects books without readable chapters', async () => {
    const tb = await withEpubTextbook()

    epub.chapters = { chapters: [], title: '', author: '' } as never
    await expect(invoke('epub:reparse-content', { textbookId: tb.id })).rejects.toThrow(
      /没有可读的章节/
    )

    epub.chapters = {
      chapters: [{ id: 'c1', title: 't', html: '<p>重解析正文</p>' }],
      title: 'T',
      author: ''
    } as never
    const reparsed = await invoke<{ success: boolean; content: string }>(
      'epub:reparse-content',
      { textbookId: tb.id }
    )
    expect(reparsed.success).toBe(true)
    expect(reparsed.content).toContain('重解析正文')

    const search = await invoke<{ excerpt: string } | null>('textbook:search-excerpt', {
      textbookId: tb.id,
      chapter: 'T'
    })
    expect(search?.excerpt).toContain('重解析正文')

    await expect(invoke('epub:reparse-content', { textbookId: 'tb_missing' })).rejects.toThrow(
      /no original file/
    )
  })

  it('returns null when the translation model answers with nothing', async () => {
    await withProvider()
    llm.chat.mockResolvedValue({ content: '' })
    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '空翻译',
      format: 'markdown',
      content: '# 第一章 熵\n\n熵是状态函数。'
    })

    await expect(
      invoke('textbook:translate-excerpt', { textbookId: tb.id, chapter: '第一章' })
    ).resolves.toBeNull()
  })
})

describe('textbook excerpt guards', () => {
  it('reports null when the textbook has no readable content', async () => {
    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '空内容',
      format: 'markdown',
      content: '# 第一章\n\n正文'
    })
    // Strip the content both from disk and from the record.
    const jsonPath = textbookPath(dataRoot, tb.id)
    const meta = JSON.parse(await readFile(jsonPath, 'utf-8')) as Record<string, unknown>
    meta.content = ''
    await writeFile(jsonPath, JSON.stringify(meta, null, 2))
    await rm(join(textbookDir(dataRoot, tb.id), 'source.md'), { force: true })

    await expect(
      invoke('textbook:search-excerpt', { textbookId: tb.id, chapter: '第一章' })
    ).resolves.toBeNull()
    await expect(
      invoke('textbook:translate-excerpt', { textbookId: tb.id, chapter: '第一章' })
    ).resolves.toBeNull()
  })

  it('returns null when a matching section has no body text', async () => {
    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '只有标题',
      format: 'markdown',
      content: '# 第一章'
    })

    await expect(
      invoke('textbook:search-excerpt', { textbookId: tb.id, chapter: '第一章' })
    ).resolves.toBeNull()
  })

  it('reports a redo failure without breaking the handler', async () => {
    await withProvider()
    llmByPrompt()
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '补做出错'
    })
    await invoke('message:send', { conversationId: conv.id, content: '问' })
    await invoke('message:send', { conversationId: conv.id, content: '答', role: 'assistant' })
    // A file where the artifacts directory belongs → persisting throws.
    await writeFile(artifactsDir(dataRoot, conv.id), 'not a directory')

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await invoke<{ success: boolean; artifacts: number; types: string[] }>(
        'conversation:redo-artifacts',
        { conversationId: conv.id, types: ['lesson_summary'] }
      )
      expect(result).toEqual({ success: false, artifacts: 0, types: ['lesson_summary'] })
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Artifact redo error'),
        expect.anything()
      )
    } finally {
      error.mockRestore()
    }
  })
})

describe('writeback failure logging', () => {
  it('warns when the textbook progress writeback fails', async () => {
    await withProvider()
    llmByPrompt()
    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '进度写回',
      format: 'markdown',
      content: '# 第一章 熵\n\n熵是状态函数。'
    })
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      textbookId: tb.id,
      title: '进度失败'
    })
    await invoke('message:send', { conversationId: conv.id, content: '熵是什么？' })
    await invoke('message:send', { conversationId: conv.id, content: '状态函数。', role: 'assistant' })

    atomicFail.paths.push(textbookPath(dataRoot, tb.id).replace(/\\/g, '/').split('/').pop()!)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await invoke<{ success: boolean }>('conversation:redo-artifacts', {
        conversationId: conv.id,
        types: ['progress', 'lesson_summary']
      })
      expect(result.success).toBe(true)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write textbook progress'),
        expect.anything()
      )
    } finally {
      warn.mockRestore()
      atomicFail.paths.length = 0
    }
  })
})

describe('reading notes in the diary prompt', () => {
  it('formats chapter, position and reader notes into the prompt', async () => {
    await withProvider()
    llmByPrompt()
    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '带批注',
      format: 'markdown',
      content: '# 第一章 熵\n\n熵是状态函数。'
    })
    await invoke('reading-note:create', {
      textbookId: tb.id,
      content: '熵增原理很重要',
      position: '3',
      chapter: '第一章',
      readerNote: '复习重点'
    })
    await invoke('reading-note:create', {
      textbookId: tb.id,
      content: '第二处批注',
      position: '12'
    })
    await invoke('reading-note:create', { textbookId: tb.id, content: '没有定位', position: '' })

    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      textbookId: tb.id,
      title: '批注课堂'
    })
    await invoke('message:send', { conversationId: conv.id, content: '熵是什么？' })
    await invoke('message:send', { conversationId: conv.id, content: '状态函数。', role: 'assistant' })
    await invoke('conversation:redo-artifacts', { conversationId: conv.id, types: ['diary'] })

    const diaryCall = llm.chat.mock.calls.find((call) =>
      String(call[0]?.[0]?.content ?? '').includes('课后日记')
    )
    const prompt = String(diaryCall?.[0]?.[1]?.content ?? '')
    expect(prompt).toContain('第一章')
    expect(prompt).toContain('位置 12')
    expect(prompt).toContain('- 教材：没有定位')
    expect(prompt).toContain('（笔记：复习重点）')
    expect(prompt).toContain('熵增原理很重要')
  })
})

describe('data IPC — optional branches', () => {
  it('deletes an unknown conversation with the id as the archive label', async () => {
    // Missing conversation → the archive label falls back to the id; the
    // forced rm still reports success.
    await expect(invoke('conversation:delete', { conversationId: 'conv_missing' })).resolves.toBe(true)
  })

  it('keeps caches when truncation changes nothing', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '截断'
    })
    const msg = await invoke<{ id: string }>('message:send', {
      conversationId: conv.id,
      content: '唯一一条'
    })

    // Truncating at the last message is a no-op (clear caches branch false).
    await expect(
      invoke('conversation:truncate', { conversationId: conv.id, messageId: msg.id })
    ).resolves.toBe(false)
  })

  it('ignores reading-note updates for unknown notes', async () => {
    await expect(
      invoke('reading-note:update', { noteId: 'note_missing', textbookId: 'tb_1', content: 'x' })
    ).resolves.toBeNull()
  })

  it('accepts dialog calls without input and reports cancellations', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })

    await expect(invoke('dialog:openFile')).resolves.toMatchObject({ canceled: true })
    await expect(invoke('dialog:saveFile')).resolves.toMatchObject({ canceled: true })
  })

  it('asks confirmations without a focused window', async () => {
    mocks.FakeBrowserWindow.focused = null
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 })

    await expect(invoke('dialog:confirm', { message: '继续？' })).resolves.toBe(true)
  })

  it('falls back to the default model when the active provider has none', { timeout: 30_000 }, async () => {
    const providerStore = new ProviderStore(dataRoot, fakeSafeStorage)
    const provider = await providerStore.create({
      name: 'NoModel',
      type: 'deepseek',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-nomodel',
      models: [],
      selectedModel: ''
    })
    await providerStore.update(provider.id, { isActive: true })
    llm.chat.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      if ((messages[0]?.content ?? '').includes('学习分析助手')) {
        return { content: JSON.stringify([{ name: '熵', performance: 'correct' }]) }
      }
      return { content: '通用内容' }
    })

    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '默认模型'
    })
    await invoke('message:send', { conversationId: conv.id, content: '问' })
    await invoke('message:send', { conversationId: conv.id, content: '答', role: 'assistant' })

    await vi.waitFor(() => expect(llm.clients.length).toBeGreaterThan(0), { timeout: 10_000 })
    expect(llm.clients.some((c) => c.model === 'deepseek-v4-flash')).toBe(true)
  })

  it('validates the backup restore input shape', async () => {
    await expect(invoke('data:restore-backup', 42 as never)).resolves.toMatchObject({
      success: false
    })
  })

  it('treats a non-array favorites payload as empty', async () => {
    await writeFile(join(dataRoot, 'flashcard-favorites.json'), JSON.stringify({ nope: true }))
    await expect(invoke('flashcard:get-favorites')).resolves.toEqual([])
  })

  it('ignores non-flashcard artifacts when counting due cards', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '非卡片'
    })
    await invoke('artifact:create', {
      conversationId: conv.id,
      type: 'lesson_summary',
      content: '## 总结'
    })
    await invoke('conversation:end', { conversationId: conv.id })

    await expect(invoke('stats:due-flashcards')).resolves.toMatchObject({ due: 0, total: 0 })
  })
})

describe('deep branch coverage', () => {
  it('reports a failed delete and survives raw non-Error failures', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '删除失败'
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      fsFail.rmPaths.push(conv.id)
      await expect(invoke('conversation:delete', { conversationId: conv.id })).resolves.toBe(false)
    } finally {
      fsFail.rmPaths.length = 0
      warn.mockRestore()
    }
  })

  it('logs a raw non-Error when the artifact queue notification itself throws', { timeout: 30_000 }, async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const allWindows = vi
      .spyOn(mocks.FakeBrowserWindow, 'getAllWindows')
      .mockImplementation(() => {
        throw 'window registry gone'
      })
    try {
      const conv = await invoke<{ id: string }>('conversation:create', {
        companionId: 'comp_landau',
        title: '窗口崩溃'
      })
      await invoke('conversation:end', { conversationId: conv.id })

      await vi.waitFor(
        () =>
          expect(error).toHaveBeenCalledWith(
            '[artifacts] queue error (non-fatal):',
            'window registry gone'
          ),
        { timeout: 10_000, interval: 50 }
      )
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Background artifact generation error'),
        'window registry gone'
      )
    } finally {
      allWindows.mockRestore()
      error.mockRestore()
    }
  })

  it('logs a raw non-Error when the concept store write fails', { timeout: 30_000 }, async () => {
    await withProvider()
    llm.chat.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      if ((messages[0]?.content ?? '').includes('学习分析助手')) {
        return { content: JSON.stringify([{ name: '熵', performance: 'correct' }]) }
      }
      return { content: '通用内容' }
    })
    atomicFail.rawPaths.push('concepts.json')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const conv = await invoke<{ id: string }>('conversation:create', {
        companionId: 'comp_landau',
        title: '原始错误'
      })
      await invoke('message:send', { conversationId: conv.id, content: '问' })
      await invoke('message:send', { conversationId: conv.id, content: '答', role: 'assistant' })

      await vi.waitFor(
        () =>
          expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('概念更新失败'),
            'disk full (raw)'
          ),
        { timeout: 10_000, interval: 50 }
      )
    } finally {
      atomicFail.rawPaths.length = 0
      warn.mockRestore()
    }
  })

  it('degrades gracefully when no provider store is registered', async () => {
    mocks.handlers.clear()
    registerConversationIpc(dataRoot)

    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '无服务',
      format: 'markdown',
      content: '# 第一章 熵\n\n熵是状态函数。'
    })
    await expect(
      invoke('textbook:translate-excerpt', { textbookId: tb.id, chapter: '熵' })
    ).resolves.toBeNull()

    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '无服务课堂'
    })
    await invoke('message:send', { conversationId: conv.id, content: '熵是什么？' })
    await invoke('message:send', { conversationId: conv.id, content: '状态函数。', role: 'assistant' })
    await flush()

    const end = await invoke<{ success: boolean }>('conversation:end', {
      conversationId: conv.id
    })
    expect(end.success).toBe(true)
    await flush()
    await expect(
      invoke<unknown[]>('artifact:list', { conversationId: conv.id })
    ).resolves.toEqual([])
  })

  it('skips provider-powered flows when the active key file is gone', async () => {
    await withProvider()
    const providerStore = new ProviderStore(dataRoot, fakeSafeStorage)
    const active = await providerStore.getActive()
    await rm(join(configDir(dataRoot), `${active!.id}.key.enc`), { force: true })

    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '无钥匙',
      format: 'markdown',
      content: '# 第一章 熵\n\n熵是状态函数。'
    })
    await expect(
      invoke('textbook:translate-excerpt', { textbookId: tb.id, chapter: '熵' })
    ).resolves.toBeNull()

    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '无钥匙补做'
    })
    const result = await invoke<{ success: boolean; artifacts: number }>(
      'conversation:redo-artifacts',
      { conversationId: conv.id, types: ['lesson_summary'] }
    )
    expect(result).toMatchObject({ success: true, artifacts: 0 })
    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('uses default endpoint and model when the active provider fields are empty', { timeout: 30_000 }, async () => {
    const providerStore = new ProviderStore(dataRoot, fakeSafeStorage)
    const provider = await providerStore.create({
      name: 'Empty',
      type: 'deepseek',
      baseUrl: '',
      apiKey: 'sk-empty',
      models: [],
      selectedModel: ''
    })
    await providerStore.update(provider.id, { isActive: true })
    llmByPrompt()

    const tb = await invoke<{ id: string }>('textbook:create', {
      title: '默认端点',
      format: 'markdown',
      content: '# 第一章 熵\n\n熵是状态函数。'
    })
    const translated = await invoke<{ translation: string }>('textbook:translate-excerpt', {
      textbookId: tb.id,
      chapter: '熵'
    })
    expect(translated.translation).toBe('熵是状态函数。')

    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '默认模型'
    })
    await invoke('message:send', { conversationId: conv.id, content: '熵是什么？' })
    await invoke('message:send', { conversationId: conv.id, content: '状态函数。', role: 'assistant' })

    const result = await invoke<{ success: boolean; artifacts: number }>(
      'conversation:redo-artifacts',
      { conversationId: conv.id, types: ['lesson_summary'] }
    )
    expect(result).toMatchObject({ success: true, artifacts: 1 })

    // The debounced concept update also ran with the default endpoint/model.
    await vi.waitFor(
      () =>
        expect(
          llm.chat.mock.calls.some((call) =>
            String(call[0]?.[0]?.content ?? '').includes('学习分析助手')
          )
        ).toBe(true),
      { timeout: 10_000, interval: 50 }
    )
  })

  it('writes global pal moments and handoff metadata for a class without a textbook', async () => {
    await withProvider()
    llmByPrompt()
    await loadReferenceCompanions({ candidatesDir, companionDir: companionDir(dataRoot) })
    await writeFile(palMomentsPath(dataRoot), '更早的互动备忘。', 'utf-8')

    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_missing',
      title: '无教材'
    })
    await invoke('message:send', { conversationId: conv.id, content: '熵是什么？' })
    await invoke('message:send', { conversationId: conv.id, content: '状态函数。', role: 'assistant' })

    const result = await invoke<{ success: boolean }>('conversation:redo-artifacts', {
      conversationId: conv.id,
      types: ['pal_moments', 'handoff_tail', 'diary']
    })
    expect(result.success).toBe(true)

    const palMoments = await readFile(palMomentsPath(dataRoot), 'utf-8')
    expect(palMoments).toContain('更早的互动备忘')
    expect(palMoments).toContain('---')

    const meta = JSON.parse(await readFile(handoffMetaPath(dataRoot), 'utf-8')) as Record<
      string,
      { endingPage: number | null; textbookId: string | null; companionName: string }
    >
    expect(meta.comp_missing).toMatchObject({
      endingPage: null,
      textbookId: null,
      companionName: 'comp_missing'
    })
  })

  it('parents confirmations to the focused window when one exists', async () => {
    const win = new mocks.FakeBrowserWindow()
    mocks.FakeBrowserWindow.focused = win
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 })

    await expect(invoke('dialog:confirm', { message: '真的下课？' })).resolves.toBe(true)
    expect(mocks.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({ message: '真的下课？' })
    )
  })

  it('wraps a non-Error parse failure with the format name', async () => {
    const rawPath = join(dataRoot, 'raw.pdf')
    await writeFile(rawPath, 'not a pdf')
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [rawPath] })
    await invoke('dialog:openFile', {})

    parsers.extractTextThrow = 'raw parser exploded'
    try {
      await expect(
        invoke('textbook:create', { title: '原始解析错误', format: 'pdf', sourceFile: rawPath })
      ).rejects.toThrow('Failed to parse PDF file: raw parser exploded')
    } finally {
      parsers.extractTextThrow = null
    }
  })
})

describe('flashcard:generate-from-concepts', () => {
  const cardContent = '- 问题：熵是什么？\n- 答案：状态函数'

  /** Answer concept extraction with [] and the concept-card prompt with cards. */
  function mockLlmWithCards(): void {
    llm.chat.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      const sys = messages[0]?.content ?? ''
      if (sys.includes('学习分析助手')) return { content: '[]' }
      if (sys.includes('掌握薄弱')) return { content: cardContent }
      return { content: '通用内容' }
    })
  }

  /** Seed one weak concept (two wrong answers + misconception). */
  async function seedWeakConcept(
    conversationId: string,
    messageIds: string[],
    name = '熵'
  ): Promise<void> {
    const store = new ConceptStore(dataRoot)
    await store.applyEvidence({
      conversationId,
      textbookId: null,
      messageIds,
      updates: [
        { name, performance: 'incorrect', misconception: '熵是能量' },
        { name, performance: 'incorrect' }
      ]
    })
  }

  it('creates the flashcards artifact from weak concepts with evidence', async () => {
    await withProvider()
    mockLlmWithCards()
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '熵'
    })
    const user = await invoke<{ id: string }>('message:send', {
      conversationId: conv.id,
      content: '熵是什么？'
    })
    const assistant = await invoke<{ id: string }>('message:send', {
      conversationId: conv.id,
      content: '熵是状态函数。',
      role: 'assistant'
    })
    await seedWeakConcept(conv.id, [user.id, assistant.id])

    const res = await invoke<{ success: boolean; added: number; concepts: string[] }>(
      'flashcard:generate-from-concepts',
      { conversationId: conv.id }
    )
    expect(res).toMatchObject({ success: true, added: 1, concepts: ['熵'] })

    const arts = await invoke<Array<{ type: string; content: string }>>('artifact:list', {
      conversationId: conv.id
    })
    const flashcards = arts.filter((a) => a.type === 'flashcards')
    expect(flashcards).toHaveLength(1)
    expect(flashcards[0].content).toContain('问题：熵是什么？')

    const cardCall = llm.chat.mock.calls.find((c) =>
      String(c[0]?.[0]?.content ?? '').includes('掌握薄弱')
    )
    expect(cardCall).toBeTruthy()
    const input = String(cardCall![0][1].content)
    expect(input).toContain('熵（掌握度 28%，误解点：熵是能量）')
    expect(input).toContain('熵是状态函数。')
  })

  it('appends to an existing flashcards artifact without touching SRS indices', async () => {
    await withProvider()
    mockLlmWithCards()
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '追加'
    })
    await invoke('artifact:create', {
      conversationId: conv.id,
      type: 'flashcards',
      content: '- 问题：旧题\n- 答案：旧答'
    })
    // Evidence ids that are not part of the conversation are dropped.
    await seedWeakConcept(conv.id, ['ghost_message'])

    const res = await invoke<{ success: boolean; added: number }>(
      'flashcard:generate-from-concepts',
      { conversationId: conv.id }
    )
    expect(res).toMatchObject({ success: true, added: 1 })

    const arts = await invoke<Array<{ type: string; content: string }>>('artifact:list', {
      conversationId: conv.id
    })
    const flashcards = arts.filter((a) => a.type === 'flashcards')
    expect(flashcards).toHaveLength(1)
    expect(flashcards[0].content).toContain('旧题')
    expect(flashcards[0].content).toContain('熵是什么')

    const cardCall = llm.chat.mock.calls.find((c) =>
      String(c[0]?.[0]?.content ?? '').includes('掌握薄弱')
    )
    expect(String(cardCall![0][1].content)).not.toContain('课堂证据摘录')
  })

  it('reports nothing to generate when no concept is weak', async () => {
    await withProvider()
    mockLlmWithCards()
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '无薄弱'
    })
    const store = new ConceptStore(dataRoot)
    await store.applyEvidence({
      conversationId: conv.id,
      textbookId: null,
      messageIds: ['m1'],
      updates: [{ name: '熟悉的概念', performance: 'correct' }]
    })

    await expect(
      invoke('flashcard:generate-from-concepts', { conversationId: conv.id })
    ).resolves.toEqual({ success: true, added: 0, concepts: [] })
    expect(
      llm.chat.mock.calls.some((c) => String(c[0]?.[0]?.content ?? '').includes('掌握薄弱'))
    ).toBe(false)
  })

  it('reports a missing conversation', async () => {
    await expect(
      invoke('flashcard:generate-from-concepts', { conversationId: 'conv_missing' })
    ).resolves.toMatchObject({ success: false, added: 0, error: '课堂不存在' })
  })

  it('reports missing provider, missing key and missing provider store', async () => {
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '无模型'
    })
    await seedWeakConcept(conv.id, ['m1'])

    // No active provider configured.
    await expect(
      invoke('flashcard:generate-from-concepts', { conversationId: conv.id })
    ).resolves.toMatchObject({ success: false, error: '未配置模型服务' })

    // Active provider whose key file is gone.
    await withProvider()
    const providerStore = new ProviderStore(dataRoot, fakeSafeStorage)
    const active = await providerStore.getActive()
    await rm(join(configDir(dataRoot), `${active!.id}.key.enc`), { force: true })
    await expect(
      invoke('flashcard:generate-from-concepts', { conversationId: conv.id })
    ).resolves.toMatchObject({ success: false, error: '未配置模型密钥' })

    // No provider store registered at all (legacy wiring).
    mocks.handlers.clear()
    registerConversationIpc(dataRoot)
    await expect(
      invoke('flashcard:generate-from-concepts', { conversationId: conv.id })
    ).resolves.toMatchObject({ success: false, error: '未配置模型服务' })
  })

  it('uses the default model when the active provider has none', async () => {
    const providerStore = new ProviderStore(dataRoot, fakeSafeStorage)
    const provider = await providerStore.create({
      name: 'Empty',
      type: 'deepseek',
      baseUrl: '',
      apiKey: 'sk-empty',
      models: [],
      selectedModel: ''
    })
    await providerStore.update(provider.id, { isActive: true })
    mockLlmWithCards()
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '默认模型'
    })
    await seedWeakConcept(conv.id, ['m1'])

    await expect(
      invoke('flashcard:generate-from-concepts', { conversationId: conv.id })
    ).resolves.toMatchObject({ success: true, added: 1 })
    expect(llm.clients.at(-1)?.model).toBe('deepseek-v4-flash')
  })

  it('reports unparseable output and both failure kinds', async () => {
    await withProvider()
    const conv = await invoke<{ id: string }>('conversation:create', {
      companionId: 'comp_landau',
      title: '失败'
    })
    await seedWeakConcept(conv.id, ['m1'])

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      llm.chat.mockResolvedValue({ content: '抱歉，无法生成' })
      await expect(
        invoke('flashcard:generate-from-concepts', { conversationId: conv.id })
      ).resolves.toMatchObject({ success: false, error: '生成失败，请重试' })

      llm.chat.mockRejectedValue(new Error('429 rate limited'))
      await expect(
        invoke('flashcard:generate-from-concepts', { conversationId: conv.id })
      ).resolves.toMatchObject({ success: false, error: '429 rate limited' })

      llm.chat.mockRejectedValue('offline')
      await expect(
        invoke('flashcard:generate-from-concepts', { conversationId: conv.id })
      ).resolves.toMatchObject({ success: false, error: '生成失败，请重试' })
    } finally {
      error.mockRestore()
    }
  })
})

describe('concept spaced review', () => {
  /** Seed one concept whose schedule is already due (reviewed long ago). */
  async function seedDueConcept(name: string, textbookId: string | null = null): Promise<string> {
    const store = new ConceptStore(dataRoot)
    await store.applyEvidence({
      conversationId: 'conv_review',
      textbookId,
      messageIds: ['m1'],
      updates: [{ name, performance: 'correct' }]
    })
    const state = (await store.load()).find((c) => c.name === name)!
    await store.review(state.id, textbookId, 'good', Date.now() - 10 * 86_400_000)
    return state.id
  }

  it('counts due concepts and advances the schedule through self-rating', async () => {
    await seedDueConcept('熵')

    await expect(invoke('stats:due-concepts')).resolves.toEqual({ due: 1, total: 1 })

    const states = await invoke<Array<{ id: string; srs: { nextReview: number } }>>(
      'concepts:list',
      'conv_review'
    )
    expect(states[0].srs.nextReview).toBeLessThan(Date.now())

    const updated = await invoke<{ srs: { reps: number; nextReview: number } } | null>(
      'concepts:review',
      { conceptId: states[0].id, textbookId: null, rating: 'good' }
    )
    expect(updated?.srs.reps).toBe(2)
    expect(updated!.srs.nextReview).toBeGreaterThan(Date.now())

    await expect(invoke('stats:due-concepts')).resolves.toEqual({ due: 0, total: 1 })
  })

  it('returns null for unknown concepts and rejects invalid ratings', async () => {
    await expect(
      invoke('concepts:review', { conceptId: 'concept_missing', textbookId: null, rating: 'good' })
    ).resolves.toBeNull()

    await expect(
      invoke('concepts:review', { conceptId: 'concept_missing', textbookId: null, rating: 'nope' })
    ).rejects.toThrow()
  })
})
