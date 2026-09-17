/**
 * data.ts IPC integration tests.
 *
 * Registers the real handler set against a temp data root (real stores, real
 * files) and invokes the handlers through a captured ipcMain map. electron is
 * mocked: dialogs return scripted results, BrowserWindow is a minimal fake so
 * pdf/screenshot flows can run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
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
import { ProviderStore } from '../../../src/main/storage/provider-store'
import { loadReferenceCompanions } from '../../../src/main/companions/reference-loader'
import {
  companionDir,
  learnerPath,
  palMomentsPath,
  palMomentsPathForTextbook,
  relationPath,
  handoffMetaPath
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
let stores: ReturnType<typeof registerConversationIpc>

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

  const providerStore = new ProviderStore(dataRoot, fakeSafeStorage)
  stores = registerConversationIpc(dataRoot, providerStore)
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
  it('generates artifacts and writes back learner/diary/handoff state', async () => {
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

    // The background queue persists every regular artifact type. Generous
    // timeout: the mock is fast but 15 artifact writes + parallel test files
    // can be slow on a loaded machine.
    await vi.waitFor(
      async () => {
        const list = await invoke<Array<{ type: string }>>('artifact:list', {
          conversationId: conv.id
        })
        expect(list.length).toBeGreaterThanOrEqual(10)
      },
      { timeout: 20_000, interval: 50 }
    )
    const types = (
      await invoke<Array<{ type: string }>>('artifact:list', { conversationId: conv.id })
    ).map((a) => a.type)
    expect(types).toEqual(
      expect.arrayContaining([
        'lesson_summary',
        'flashcards',
        'diary',
        'progress',
        'handoff_tail',
        'feynman_note',
        'lesson_timeline',
        'lesson_faq'
      ])
    )

    // Diary writeback (monthly file).
    const months = await invoke<string[]>('diary:list-months', {})
    expect(months).toHaveLength(1)
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
