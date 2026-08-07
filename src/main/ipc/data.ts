import { ipcMain, dialog, BrowserWindow } from 'electron'
import { join, dirname } from 'node:path'
import { readFile, mkdir } from 'node:fs/promises'
import { CompanionSchema } from '../../shared/schemas/companion'
import { ConversationStore } from '../storage/conversation-store'
import { TextbookStore } from '../storage/textbook-store'
import { ArtifactStore } from '../storage/artifact-store'
import { ReadingNoteStore } from '../storage/reading-note-store'
import { DiaryStore } from '../storage/diary-store'
import type { ProviderStore } from '../storage/provider-store'
import { generateArtifacts } from '../artifacts/generate'
import { restoreFromBackup } from '../backup/restore'
import { ConceptStore } from '../learning-memory/concept-store'
import { extractConceptUpdates } from '../learning-memory/concept-extractor'
import { parseFlashcards, rebuildArtifactContent } from '../../shared/flashcard-utils'
import { extractText, getEpubChapters, epubChaptersToText } from '../parsers'
import { splitSections, headingMatches } from '../prompt/textbook-retrieval'
import { DeepSeekClient } from '../llm/deepseek-client'
import { createDeepSeekHttpAdapter } from '../llm/deepseek-http-adapter'
import { PickedFileRegistry } from './picked-files'
import { createBackupZip } from '../backup/backup'
import {
  learnerPath,
  palMomentsPath,
  palMomentsPathForTextbook,
  relationPath,
  handoffMetaPath,
  textbookDir,
  companionDir,
  conversationDir
} from '../storage/app-data'
import { archiveItem } from '../storage/archive-store'
import {
  IpcCreateConversationInputSchema,
  IpcGetConversationInputSchema,
  IpcListConversationsInputSchema,
  IpcDeleteConversationInputSchema,
  IpcUpdateTitleInputSchema,
  IpcEndClassInputSchema,
  IpcSendMessageInputSchema,
  IpcGetMessagesInputSchema,
  IpcSearchMessagesInputSchema,
  IpcUpdateMessageInputSchema,
  IpcDeleteMessageInputSchema,
  IpcRedoArtifactsInputSchema,
  IpcTruncateConversationInputSchema,
  IpcCreateArtifactInputSchema,
  IpcGetArtifactInputSchema,
  IpcUpdateArtifactInputSchema,
  IpcListArtifactsInputSchema,
  IpcCreateTextbookFullInputSchema,
  IpcGetTextbookInputSchema,
  IpcListTextbooksInputSchema,
  IpcUpdateTextbookInputSchema,
  IpcUpdateTextbookProgressInputSchema,
  IpcDeleteTextbookInputSchema,
  IpcReadOriginalInputSchema,
  IpcReadEpubChaptersInputSchema,
  IpcTextbookSearchExcerptInputSchema,
  IpcTextbookTranslateExcerptInputSchema,
  IpcCreateReadingNoteInputSchema,
  IpcListReadingNotesInputSchema,
  IpcUpdateReadingNoteInputSchema,
  IpcDeleteReadingNoteInputSchema,
  IpcWriteTextFileInputSchema,
  IpcExportBackupInputSchema,
  IpcOpenFileDialogInputSchema,
  IpcSaveFileDialogInputSchema,
  IpcConfirmDialogInputSchema,
  IpcDiaryListMonthsInputSchema,
  IpcDiaryGetMonthInputSchema,
  IpcFlashcardDeleteCardsInputSchema,
  IpcPdfExportInputSchema,
  IpcScreenshotInputSchema,
  IpcReparseEpubInputSchema
} from '../../shared/schemas/ipc'
import {
  ArtifactType,
  type ClassMode,
  type ConversationId
} from '../../shared/types/ids'
import { ARTIFACTS_GENERATED } from '../../shared/channel-names'
import { atomicWriteFile } from '../storage/atomic-write'

/** In-app reader loads the whole file into memory — cap it. */
const MAX_ORIGINAL_SIZE = 512 * 1024 * 1024

/** Structured handoff metadata persisted to handoff_meta.json. */
interface HandoffMetaEntry {
  savedAt: string
  prevConvId: string
  companionName: string
  companionSlot: 'a' | 'b' | 'c' | null
  endingPage: number | null
  /** 该课堂使用的教材 —— 接力尾巴按教材隔离，避免新教材课堂延续旧教材内容。 */
  textbookId: string | null
}

export function registerConversationIpc(
  dataRoot: string,
  providerStore?: ProviderStore
): { conversationStore: ConversationStore; textbookStore: TextbookStore; artifactStore: ArtifactStore; readingNoteStore: ReadingNoteStore; diaryStore: DiaryStore } {
  const conversationStore = new ConversationStore(dataRoot)
  const textbookStore = new TextbookStore(dataRoot)
  const artifactStore = new ArtifactStore(dataRoot)
  const readingNoteStore = new ReadingNoteStore(dataRoot)
  const diaryStore = new DiaryStore(dataRoot)
  const conceptStore = new ConceptStore(dataRoot)
  const pickedFiles = new PickedFileRegistry()

  // Sequential background queue for end-of-class artifact generation, so
  // ending a class never blocks the UI on a dozen LLM calls.
  let artifactQueue: Promise<void> = Promise.resolve()

  function notifyArtifactsReady(
    conversationId: string,
    extra: { artifacts: number; farewell: string; failures: string[]; error?: string }
  ): void {
    const payload = { conversationId, ...extra }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(ARTIFACTS_GENERATED, payload)
    }
  }

  function queueArtifactGeneration(
    conversationId: string,
    classMode?: ClassMode
  ): void {
    artifactQueue = artifactQueue.then(async () => {
      try {
        const pipeline = await runArtifactPipeline(
          { dataRoot, providerStore, conversationStore, textbookStore, artifactStore, readingNoteStore, diaryStore },
          conversationId,
          { classMode }
        )
        notifyArtifactsReady(conversationId, {
          artifacts: pipeline.artifactCount,
          farewell: pipeline.farewell,
          failures: pipeline.failures
        })
      } catch (err) {
        console.error(`Background artifact generation error for ${conversationId}:`, err)
        notifyArtifactsReady(conversationId, {
          artifacts: 0,
          farewell: '',
          failures: [],
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })
  }

  // --- Conversation CRUD ---

  ipcMain.handle('conversation:create', async (_event, input: unknown) => {
    const parsed = IpcCreateConversationInputSchema.parse(input)
    const conv = await conversationStore.create({
      companionId: parsed.companionId,
      companionVersion: parsed.companionVersion ?? null,
      textbookId: parsed.textbookId ?? null,
      title: parsed.title
    })
    return conv
  })

  ipcMain.handle('conversation:get', async (_event, input: unknown) => {
    const parsed = IpcGetConversationInputSchema.parse(input)
    return conversationStore.get(parsed.conversationId)
  })

  ipcMain.handle('conversation:list', async () => {
    return conversationStore.list()
  })

  ipcMain.handle('conversation:delete', async (_event, input: unknown) => {
    const parsed = IpcDeleteConversationInputSchema.parse(input)
    // Archive before deleting so the class can be restored (4.0.1).
    try {
      const conv = await conversationStore.get(parsed.conversationId)
      await archiveItem(
        dataRoot,
        'conversation',
        parsed.conversationId,
        conversationDir(dataRoot, parsed.conversationId),
        conv?.title ?? parsed.conversationId
      )
    } catch (err) {
      console.warn(`Archive conversation ${parsed.conversationId} failed:`, err)
    }
    return conversationStore.delete(parsed.conversationId)
  })

  ipcMain.handle('conversation:update-title', async (_event, input: unknown) => {
    const parsed = IpcUpdateTitleInputSchema.parse(input)
    return conversationStore.updateTitle(parsed.conversationId, parsed.title)
  })

  // Rewind a conversation to a message: drop everything after it
  ipcMain.handle('conversation:truncate', async (_event, input: unknown) => {
    const parsed = IpcTruncateConversationInputSchema.parse(input)
    return conversationStore.truncateAfter(
      parsed.conversationId,
      parsed.messageId
    )
  })

  ipcMain.handle('conversation:end', async (_event, input: unknown) => {
    const parsed = IpcEndClassInputSchema.parse(input)
    const { conversationId, classMode } = parsed
    const success = await conversationStore.endConversation(conversationId)
    if (!success) return { success: false, artifacts: 0 }
    // Generate artifacts in the background; the renderer is notified via
    // ARTIFACTS_GENERATED when the results are ready.
    queueArtifactGeneration(conversationId, classMode)
    return { success: true, artifacts: 0, farewell: '', failures: [], pending: true }
  })

  // Re-run only the artifact types that failed or went missing earlier
  // (4.0.0 "post-class updates can be run again — redo only the missing work").
  ipcMain.handle('conversation:redo-artifacts', async (_event, input: unknown) => {
    const parsed = IpcRedoArtifactsInputSchema.parse(input)
    const { conversationId, types } = parsed

    const knownTypes = new Set<string>(Object.values(ArtifactType))
    const validTypes = types.filter((t): t is ArtifactType => knownTypes.has(t))
    if (validTypes.length === 0) return { success: false, artifacts: 0, types: [] as string[] }

    try {
      const pipeline = await runArtifactPipeline(
        { dataRoot, providerStore, conversationStore, textbookStore, artifactStore, readingNoteStore, diaryStore },
        conversationId,
        { types: validTypes }
      )
      return {
        success: true,
        artifacts: pipeline.artifactCount,
        types: validTypes,
        failures: pipeline.failures
      }
    } catch (err) {
      console.error(`Artifact redo error for ${conversationId}:`, err)
      return { success: false, artifacts: 0, types: validTypes }
    }
  })

  // --- Messages ---

  // 概念增量识别（Kimi 方案）：assistant 消息落地后异步分析最近一轮问答，
  // 更新概念掌握度。带每会话防抖（流式重试等场景不重复触发）。
  const lastConceptUpdateAt = new Map<string, number>()
  const CONCEPT_UPDATE_DEBOUNCE_MS = 15_000

  function scheduleConceptUpdate(conversationId: string): void {
    const now = Date.now()
    const last = lastConceptUpdateAt.get(conversationId) ?? 0
    if (now - last < CONCEPT_UPDATE_DEBOUNCE_MS) return
    lastConceptUpdateAt.set(conversationId, now)

    void (async () => {
      try {
        const msgs = await conversationStore.getMessages(conversationId)
        const recent = msgs.slice(-4)
        const lastUser = [...recent].reverse().find((m) => m.role === 'user')
        const lastAssistant = [...recent].reverse().find((m) => m.role === 'assistant')
        if (!lastUser || !lastAssistant) return

        const conv = await conversationStore.get(conversationId)
        const transcript = `${lastUser.role === 'user' ? '学习者' : '导师'}: ${lastUser.content}\n\n${lastAssistant.role === 'user' ? '学习者' : '导师'}: ${lastAssistant.content}`

        const active = providerStore ? await providerStore.getActive() : null
        if (!active) return
        const apiKey = await providerStore!.readApiKey(active.id)
        if (!apiKey) return

        const updates = await extractConceptUpdates(transcript, {
          apiKey,
          baseUrl: active.baseUrl || 'https://api.deepseek.com',
          model: active.selectedModel || 'deepseek-v4-flash'
        })
        if (!updates || updates.length === 0) return

        await conceptStore.applyEvidence({
          conversationId,
          textbookId: conv?.textbookId ?? null,
          messageIds: [lastUser.id, lastAssistant.id],
          updates
        })
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('concepts:updated', { conversationId })
        }
      } catch (err) {
        console.warn('[concepts] 概念更新失败（非致命）：', err instanceof Error ? err.message : err)
      }
    })()
  }

  ipcMain.handle('concepts:list', async (_event, input: unknown) => {
    const conversationId = typeof input === 'string' ? input : ''
    return conversationId ? conceptStore.listByConversation(conversationId) : conceptStore.load()
  })

  ipcMain.handle('message:send', async (_event, input: unknown) => {
    const parsed = IpcSendMessageInputSchema.parse(input)
    const role = parsed.role ?? 'user'
    const msg = await conversationStore.addMessage(parsed.conversationId, role, parsed.content)
    if (role === 'assistant') scheduleConceptUpdate(parsed.conversationId)
    return msg
  })

  ipcMain.handle('message:list', async (_event, input: unknown) => {
    const parsed = IpcGetMessagesInputSchema.parse(input)
    return conversationStore.getMessages(parsed.conversationId)
  })

  ipcMain.handle('message:search', async (_event, input: unknown) => {
    const parsed = IpcSearchMessagesInputSchema.parse(input)
    return conversationStore.searchMessages(
      parsed.query,
      parsed.limit,
      parsed.offset
    )
  })

  ipcMain.handle('message:update', async (_event, input: unknown) => {
    const parsed = IpcUpdateMessageInputSchema.parse(input)
    return conversationStore.updateMessage(parsed.conversationId, parsed.messageId, parsed.content)
  })

  ipcMain.handle('message:delete', async (_event, input: unknown) => {
    const parsed = IpcDeleteMessageInputSchema.parse(input)
    return conversationStore.deleteMessage(parsed.conversationId, parsed.messageId)
  })

  // --- File Dialog ---

  ipcMain.handle('dialog:openFile', async (_event, input?: unknown) => {
    const parsed = IpcOpenFileDialogInputSchema.parse(input)
    const options = parsed ?? {}
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: options.filters ?? [
        { name: '教材文件', extensions: ['pdf', 'epub', 'md', 'txt'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'EPUB', extensions: ['epub'] },
        { name: '文本', extensions: ['md', 'txt'] }
      ]
    })

    if (!result.canceled && result.filePaths.length > 0) {
      pickedFiles.add(result.filePaths[0])
    }

    return result
  })

  ipcMain.handle('dialog:saveFile', async (_event, input?: unknown) => {
    const parsed = IpcSaveFileDialogInputSchema.parse(input)
    const options = parsed ?? {}
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: options.defaultPath,
      filters: options.filters ?? [
        { name: 'Markdown', extensions: ['md'] },
        { name: '文本', extensions: ['txt'] }
      ]
    })

    if (!result.canceled && result.filePath) {
      pickedFiles.add(result.filePath)
    }

    return result
  })

  // Renderer-side window.confirm() leaves the BrowserWindow unfocused in
  // Electron (inputs stay unclickable until the app loses/regains OS focus).
  // Route confirmations through a properly parented native message box instead.
  ipcMain.handle('dialog:confirm', async (_event, input: unknown) => {
    const parsed = IpcConfirmDialogInputSchema.parse(input)
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const confirmLabel = parsed.confirmLabel ?? '继续'
    const cancelLabel = parsed.cancelLabel ?? '取消'
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      message: parsed.message,
      buttons: [confirmLabel, cancelLabel],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }
    const result = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    return result.response === 0
  })

  // --- Textbook CRUD ---

  ipcMain.handle('textbook:create', async (_event, input: unknown) => {
    const parsed = IpcCreateTextbookFullInputSchema.parse(input)

    let content = parsed.content ?? ''
    const author = parsed.author ?? ''
    const description = parsed.description ?? ''

    if ((parsed.format === 'pdf' || parsed.format === 'epub') && parsed.sourceFile) {
      if (!pickedFiles.has(parsed.sourceFile)) {
        throw new Error('Source file must be selected through the file dialog')
      }
      try {
        const result = await extractText(parsed.sourceFile)
        content = result.content
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Failed to parse ${parsed.format.toUpperCase()} file: ${message}`, { cause: err })
      }
    }

    return textbookStore.create({
      title: parsed.title,
      author,
      description,
      format: parsed.format,
      sourceFile: parsed.sourceFile?.split(/[/\\]/).pop() ?? parsed.sourceFile,
      content,
      originalSourcePath:
        (parsed.format === 'pdf' || parsed.format === 'epub') && parsed.sourceFile ? parsed.sourceFile : undefined
    })
  })

  ipcMain.handle('textbook:get', async (_event, input: unknown) => {
    const parsed = IpcGetTextbookInputSchema.parse(input)
    return textbookStore.get(parsed.textbookId)
  })

  ipcMain.handle('textbook:read-original', async (_event, input: unknown) => {
    const parsed = IpcReadOriginalInputSchema.parse(input)
    const result = await textbookStore.readOriginal(parsed.textbookId)
    if (!result) return null
    if (result.data.length > MAX_ORIGINAL_SIZE) {
      throw new Error('原件超过 512MB，无法在应用内打开')
    }
    return { data: result.data, fileName: result.fileName }
  })

  ipcMain.handle('epub:read-chapters', async (_event, input: unknown) => {
    const parsed = IpcReadEpubChaptersInputSchema.parse(input)
    const textbook = await textbookStore.get(parsed.textbookId)
    if (!textbook || !textbook.originalFile) {
      throw new Error('Textbook not found or has no original file')
    }
    const fullPath = join(textbookDir(dataRoot, parsed.textbookId), textbook.originalFile)
    return getEpubChapters(fullPath)
  })

  // Re-extract an EPUB's content from its original file. Fixes books imported
  // before the parser gained the raw-file fallback (content was only
  // "title + author"). The renderer triggers this when a stored EPUB content
  // looks empty; the rebuilt text is written back to the textbook store.
  ipcMain.handle('epub:reparse-content', async (_event, input: unknown) => {
    const parsed = IpcReparseEpubInputSchema.parse(input)
    const textbook = await textbookStore.get(parsed.textbookId)
    if (!textbook || !textbook.originalFile) {
      throw new Error('Textbook not found or has no original file')
    }
    const fullPath = join(textbookDir(dataRoot, parsed.textbookId), textbook.originalFile)
    const result = await getEpubChapters(fullPath)
    if (result.chapters.length === 0) {
      throw new Error('该 EPUB 没有可读的章节（spine 与 manifest 均未提供可读 HTML）')
    }
    const content = epubChaptersToText(result)
    await textbookStore.updateContent(parsed.textbookId, content)
    return { success: true, content }
  })

  // Look up the real textbook passage for a chat citation chip
  ipcMain.handle('textbook:search-excerpt', async (_event, input: unknown) => {
    const parsed = IpcTextbookSearchExcerptInputSchema.parse(input)
    const content = await textbookStore.getContent(parsed.textbookId)
    if (!content) return null

    const sections = splitSections(content)
    const target = parsed.chapter.trim()
    const exact = sections.find((s) => s.heading.includes(target) || target.includes(s.heading))
    const matched = exact ?? sections.find((s) => headingMatches(target, s.heading))
    if (!matched) return null

    return {
      chapter: matched.heading,
      excerpt: matched.text.slice(0, 500).trim()
    }
  })

  // Translate a textbook citation into the teaching language (Chinese).
  // 3.1.0: "Translate the textbook source in one tap" for language learners.
  ipcMain.handle('textbook:translate-excerpt', async (_event, input: unknown) => {
    const parsed = IpcTextbookTranslateExcerptInputSchema.parse(input)
    const content = await textbookStore.getContent(parsed.textbookId)
    if (!content) return null

    const sections = splitSections(content)
    const target = parsed.chapter.trim()
    const exact = sections.find((s) => s.heading.includes(target) || target.includes(s.heading))
    const matched = exact ?? sections.find((s) => headingMatches(target, s.heading))
    if (!matched) return null
    const excerpt = matched.text.slice(0, 500).trim()
    if (!excerpt) return null

    let apiKey = ''
    let model = 'deepseek-v4-flash'
    let baseUrl = 'https://api.deepseek.com'
    if (providerStore) {
      const active = await providerStore.getActive()
      if (active) {
        const key = await providerStore.readApiKey(active.id)
        if (key) {
          apiKey = key
          model = active.selectedModel || model
          baseUrl = active.baseUrl || baseUrl
        }
      }
    }
    if (!apiKey) return null

    const endpoint = baseUrl.replace(/\/$/, '') + '/chat/completions'
    const adapter = createDeepSeekHttpAdapter({ endpoint })
    const client = new DeepSeekClient(apiKey, adapter, model)
    const response = await client.chat([
      {
        role: 'system',
        content: '你是一位教材翻译助手。请把用户提供的教材原文段落翻译成简体中文。' +
          '保留专业术语（首次出现时可在括号中注出原文），不要添加任何解释或评论。'
      },
      { role: 'user', content: `【原文】\n${excerpt}` }
    ])
    if (!response.content) return null

    return {
      chapter: matched.heading,
      excerpt,
      translation: response.content.trim()
    }
  })

  ipcMain.handle('textbook:list', async () => {
    return textbookStore.list()
  })

  ipcMain.handle('textbook:update', async (_event, input: unknown) => {
    const parsed = IpcUpdateTextbookInputSchema.parse(input)
    return textbookStore.update(parsed.textbookId, parsed)
  })

  ipcMain.handle('textbook:update-progress', async (_event, input: unknown) => {
    const parsed = IpcUpdateTextbookProgressInputSchema.parse(input)
    return textbookStore.updateProgress(parsed.textbookId, parsed)
  })

  ipcMain.handle('textbook:delete', async (_event, input: unknown) => {
    const parsed = IpcDeleteTextbookInputSchema.parse(input)
    // Archive the textbook (source + notes + reading progress) before deleting (4.0.1).
    try {
      const tb = await textbookStore.get(parsed.textbookId)
      await archiveItem(
        dataRoot,
        'textbook',
        parsed.textbookId,
        textbookDir(dataRoot, parsed.textbookId),
        tb?.title ?? parsed.textbookId
      )
    } catch (err) {
      console.warn(`Archive textbook ${parsed.textbookId} failed:`, err)
    }
    return textbookStore.delete(parsed.textbookId)
  })

  // --- Reading Notes ---

  ipcMain.handle('reading-note:create', async (_event, input: unknown) => {
    const parsed = IpcCreateReadingNoteInputSchema.parse(input)
    return readingNoteStore.create({ ...parsed })
  })

  ipcMain.handle('reading-note:list', async (_event, input: unknown) => {
    const parsed = IpcListReadingNotesInputSchema.parse(input)
    return readingNoteStore.list(parsed.textbookId)
  })

  ipcMain.handle('reading-note:update', async (_event, input: unknown) => {
    const parsed = IpcUpdateReadingNoteInputSchema.parse(input)
    return readingNoteStore.update(parsed.noteId, parsed.textbookId, parsed)
  })

  ipcMain.handle('reading-note:delete', async (_event, input: unknown) => {
    const parsed = IpcDeleteReadingNoteInputSchema.parse(input)
    return readingNoteStore.delete(parsed.noteId, parsed.textbookId)
  })

  // --- Artifact CRUD ---

  ipcMain.handle('artifact:create', async (_event, input: unknown) => {
    const parsed = IpcCreateArtifactInputSchema.parse(input)
    return artifactStore.create(
      parsed.conversationId as ConversationId,
      parsed.type,
      parsed.content
    )
  })

  ipcMain.handle('artifact:get', async (_event, input: unknown) => {
    const parsed = IpcGetArtifactInputSchema.parse(input)
    return artifactStore.get(parsed.artifactId, parsed.conversationId)
  })

  ipcMain.handle('artifact:update', async (_event, input: unknown) => {
    const parsed = IpcUpdateArtifactInputSchema.parse(input)
    return artifactStore.update(
      parsed.artifactId,
      parsed.conversationId,
      parsed.content
    )
  })

  ipcMain.handle('artifact:list', async (_event, input: unknown) => {
    const parsed = IpcListArtifactsInputSchema.parse(input)
    return artifactStore.list(parsed.conversationId)
  })

  // --- File I/O ---

  ipcMain.handle('file:writeText', async (_event, input: unknown) => {
    const parsed = IpcWriteTextFileInputSchema.parse(input)
    if (!pickedFiles.has(parsed.filePath)) {
      throw new Error('Target file must be selected through the save dialog')
    }
    await atomicWriteFile(parsed.filePath, parsed.content, 'utf-8')
    return { success: true }
  })

  // Render an HTML string (produced by the renderer's markdown+KaTeX pipeline)
  // to a PDF with the KaTeX stylesheet inlined — used for 课堂记录/笔记导出.
  ipcMain.handle('pdf:export', async (_event, input: unknown) => {
    const parsed = IpcPdfExportInputSchema.parse(input)
    if (!pickedFiles.has(parsed.filePath)) {
      throw new Error('Target file must be selected through the save dialog')
    }
    let katexCss = ''
    try {
      katexCss = await readFile(require.resolve('katex/dist/katex.min.css'), 'utf-8')
    } catch {
      // Best-effort — KaTeX HTML will still render, just unstyled.
    }
    const fullHtml = [
      '<!doctype html>',
      '<html lang="zh-CN"><head><meta charset="utf-8">',
      `<style>${katexCss}`,
      '  body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1a1a1a; padding: 8px; }',
      '  h1, h2, h3 { color: #111; line-height: 1.4; }',
      '  h1 { border-bottom: 1px solid #ddd; padding-bottom: 6px; }',
      '  pre { background: #f6f8fa; padding: 12px; border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; }',
      '  blockquote { border-left: 3px solid #ccc; margin: 0; padding-left: 12px; color: #555; }',
      '  table { border-collapse: collapse; margin: 8px 0; }',
      '  td, th { border: 1px solid #ddd; padding: 4px 8px; }',
      '  code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; }',
      '  img { max-width: 100%; }',
      '</style></head><body>',
      parsed.html,
      '</body></html>'
    ].join('\n')

    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml))
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.7, bottom: 0.7, left: 0.6, right: 0.6 }
      })
      await atomicWriteFile(parsed.filePath, pdf)
      return { success: true }
    } finally {
      win.destroy()
    }
  })

  // Capture the main window as a PNG screenshot (截图导出).
  ipcMain.handle('screenshot:capture', async (_event, input: unknown) => {
    const parsed = IpcScreenshotInputSchema.parse(input)
    if (!pickedFiles.has(parsed.filePath)) {
      throw new Error('Target file must be selected through the save dialog')
    }
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No window available')
    const image = await win.webContents.capturePage()
    await atomicWriteFile(parsed.filePath, image.toPNG())
    return { success: true }
  })

  // Full local backup: zip the whole data directory
  ipcMain.handle('data:export-backup', async (_event, input: unknown) => {
    const parsed = IpcExportBackupInputSchema.parse(input)
    if (!pickedFiles.has(parsed.filePath)) {
      throw new Error('Target file must be selected through the save dialog')
    }
    return createBackupZip(dataRoot, parsed.filePath)
  })

  // Restore from a backup zip (validated path from the open dialog)
  ipcMain.handle('data:restore-backup', async (_event, input: unknown) => {
    const zipPath = typeof input === 'string' ? input : ''
    if (!zipPath || !pickedFiles.has(zipPath)) {
      return { success: false, error: '请通过文件选择框选择备份文件' }
    }
    return restoreFromBackup(dataRoot, zipPath)
  })

  // --- Flashcard SRS State (persisted for WebDAV sync) ---

  const srsStatePath = join(dataRoot, 'flashcard-srs.json')
  const favoritesPath = join(dataRoot, 'flashcard-favorites.json')

  ipcMain.handle('flashcard:get-srs-state', async () => {
    try {
      const raw = await readFile(srsStatePath, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return {}
    }
  })

  ipcMain.handle('flashcard:save-srs-state', async (_event, input: unknown) => {
    await mkdir(dataRoot, { recursive: true })
    await atomicWriteFile(srsStatePath, JSON.stringify(input), 'utf-8')
    return { success: true }
  })

  // Favorite card ids (flashcard-favorites.json, synced like SRS state).
  ipcMain.handle('flashcard:get-favorites', async () => {
    try {
      const raw = await readFile(favoritesPath, 'utf-8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })

  ipcMain.handle('flashcard:save-favorites', async (_event, input: unknown) => {
    await mkdir(dataRoot, { recursive: true })
    await atomicWriteFile(favoritesPath, JSON.stringify(Array.isArray(input) ? input : []), 'utf-8')
    return { success: true }
  })

  // Batch-delete specific cards across flashcards artifacts (2.0.0).
  ipcMain.handle('flashcard:delete-cards', async (_event, input: unknown) => {
    const parsed = IpcFlashcardDeleteCardsInputSchema.parse(input)
    const byArtifact = new Map<string, { conversationId: string; artifactId: string; indexes: number[] }>()
    for (const card of parsed.cards) {
      const key = `${card.conversationId}::${card.artifactId}`
      const entry = byArtifact.get(key) ?? {
        conversationId: card.conversationId,
        artifactId: card.artifactId,
        indexes: []
      }
      entry.indexes.push(card.cardIndex)
      byArtifact.set(key, entry)
    }

    let deleted = 0
    for (const entry of byArtifact.values()) {
      const artifact = await artifactStore.get(entry.artifactId, entry.conversationId)
      if (!artifact) continue
      const cards = parseFlashcards(artifact.content)
      const remove = new Set(entry.indexes)
      const kept = cards.filter((_, i) => !remove.has(i))
      if (kept.length === cards.length) continue
      if (kept.length === 0) {
        await artifactStore.update(entry.artifactId, entry.conversationId, '')
      } else {
        await artifactStore.update(entry.artifactId, entry.conversationId, rebuildArtifactContent(kept))
      }
      deleted += cards.length - kept.length
    }
    return { success: true, deleted }
  })

  // --- Diary (monthly files) ---

  ipcMain.handle('diary:list-months', async (_event, input: unknown) => {
    const parsed = IpcDiaryListMonthsInputSchema.parse(input)
    return diaryStore.listMonths()
  })

  ipcMain.handle('diary:get-month', async (_event, input: unknown) => {
    const parsed = IpcDiaryGetMonthInputSchema.parse(input)
    return diaryStore.getMonth(parsed.month)
  })

  return { conversationStore, textbookStore, artifactStore, readingNoteStore, diaryStore }
}

// ---------------------------------------------------------------
// Artifact pipeline — generate + persist + writebacks (shared by
// conversation:end and conversation:redo-artifacts)
// ---------------------------------------------------------------

interface ArtifactPipelineDeps {
  dataRoot: string
  providerStore?: ProviderStore
  conversationStore: ConversationStore
  textbookStore: TextbookStore
  artifactStore: ArtifactStore
  readingNoteStore: ReadingNoteStore
  diaryStore: DiaryStore
}

interface ArtifactPipelineResult {
  artifactCount: number
  farewell: string
  failures: string[]
}

async function runArtifactPipeline(
  deps: ArtifactPipelineDeps,
  conversationId: string,
  options: { classMode?: ClassMode; types?: ArtifactType[] } = {}
): Promise<ArtifactPipelineResult> {
  const { dataRoot, providerStore, conversationStore, textbookStore, artifactStore, readingNoteStore, diaryStore } = deps
  const { classMode, types } = options

  // 本课教材的阅读批注（供日记产物参考；读取失败不影响产物生成）
  const conv = await conversationStore.get(conversationId)
  let readingNotes = ''
  if (conv?.textbookId) {
    try {
      const notes = await readingNoteStore.list(conv.textbookId)
      const parts = notes.slice(0, 12).map((n) => {
        const loc = n.chapter || (n.position ? `位置 ${n.position}` : '教材')
        const noteText = n.readerNote ? `（笔记：${n.readerNote}）` : ''
        return `- ${loc}：${n.content.slice(0, 120)}${noteText}`
      })
      readingNotes = parts.join('\n').slice(0, 1500)
    } catch {
      // best-effort
    }
  }

  let apiKey = ''
  let model = 'deepseek-v4-flash'
  let baseUrl = 'https://api.deepseek.com'
  if (providerStore) {
    const active = await providerStore.getActive()
    if (active) {
      const key = await providerStore.readApiKey(active.id)
      if (key) {
        apiKey = key
        model = active.selectedModel || model
        baseUrl = active.baseUrl || baseUrl
      }
    }
  }
  if (!apiKey) {
    return { artifactCount: 0, farewell: '', failures: [] }
  }

  const messages = await conversationStore.getMessages(conversationId)
  const { results, failures: genFailures } = await generateArtifacts(
    messages,
    { apiKey, model, baseUrl },
    { classMode, types, readingNotes: readingNotes || undefined }
  )

  let artifactCount = 0
  let farewellContent = ''
  let progressContent = ''
  let learnerProfileContent = ''
  let palMomentsContent = ''
  let relationContent = ''
  let handoffTailContent = ''
  let diaryContent = ''

  for (const result of results) {
    if (result.type === ArtifactType.Farewell) {
      farewellContent = result.content
      artifactCount++
      continue
    }
    if (result.type === ArtifactType.LearnerProfile) {
      learnerProfileContent = result.content
      artifactCount++
      continue
    }
    if (result.type === ArtifactType.PalMoments) {
      palMomentsContent = result.content
      artifactCount++
      continue
    }
    if (result.type === ArtifactType.Relation) {
      relationContent = result.content
      artifactCount++
      continue
    }
    await artifactStore.create(
      conversationId as ConversationId,
      result.type,
      result.content
    )
    artifactCount++
    if (result.type === ArtifactType.Progress) progressContent = result.content
    if (result.type === ArtifactType.HandoffTail) handoffTailContent = result.content
    if (result.type === ArtifactType.Diary) diaryContent = result.content
  }
  // Writeback: save progress artifact content to textbook progress
  if (progressContent && conv?.textbookId) {
    try {
      await textbookStore.updateProgress(conv.textbookId, {
        lastPosition: progressContent
      })
    } catch (err) {
      console.warn(`Failed to write textbook progress for ${conversationId}:`, err)
    }
  }

  // Writeback: save learner profile to learner.md
  if (learnerProfileContent) {
    try {
      await atomicWriteFile(learnerPath(dataRoot), learnerProfileContent, 'utf-8')
    } catch (err) {
      console.warn(`Failed to write learner profile for ${conversationId}:`, err)
    }
  }

  // Writeback: prepend pal moments entry. 有教材课堂写入按教材隔离的文件
  //（pal_moments_{textbookId}.md），避免串到其他教材的新课堂。
  if (palMomentsContent) {
    try {
      const filePath = conv?.textbookId
        ? palMomentsPathForTextbook(dataRoot, conv.textbookId)
        : palMomentsPath(dataRoot)
      let existing = ''
      try { existing = await readFile(filePath, 'utf-8') } catch { /* file doesn't exist yet */ }
      const merged = palMomentsContent + (existing ? '\n\n---\n\n' + existing : '')
      await atomicWriteFile(filePath, merged, 'utf-8')
    } catch (err) {
      console.warn(`Failed to write pal moments for ${conversationId}:`, err)
    }
  }

  // Writeback: save relation state to relation_{companionId}.md
  if (relationContent && conv?.companionId) {
    try {
      await atomicWriteFile(
        relationPath(dataRoot, conv.companionId),
        relationContent,
        'utf-8'
      )
    } catch (err) {
      console.warn(`Failed to write relation state for ${conversationId}:`, err)
    }
  }

  // Writeback: save structured handoff metadata (handoff_meta.json) so the
  // next session can locate the handoff tail precisely instead of guessing
  // by companionId + endedAt sorting.
  if (handoffTailContent && conv) {
    try {
      const filePath = handoffMetaPath(dataRoot)
      let meta: Record<string, HandoffMetaEntry> = {}
      try { meta = JSON.parse(await readFile(filePath, 'utf-8')) } catch { /* no meta yet */ }
      const companionName = (await readCompanionName(dataRoot, conv.companionId)) ?? conv.companionId
      let endingPage: number | null = null
      if (conv.textbookId) {
        const tb = await textbookStore.get(conv.textbookId)
        endingPage = tb?.progress.currentPage ?? null
      }
      meta[conv.companionId] = {
        savedAt: new Date().toISOString(),
        prevConvId: conversationId,
        companionName,
        companionSlot: null,
        endingPage,
        textbookId: conv.textbookId ?? null
      }
      await mkdir(dirname(filePath), { recursive: true })
      await atomicWriteFile(filePath, JSON.stringify(meta, null, 2), 'utf-8')
    } catch (err) {
      console.warn(`Failed to write handoff meta for ${conversationId}:`, err)
    }
  }

  // Writeback: append the diary to the monthly diary file (diary/YYYY-MM.md)
  if (diaryContent && conv) {
    try {
      const companionName = (await readCompanionName(dataRoot, conv.companionId)) ?? conv.companionId
      await diaryStore.append({
        date: new Date().toISOString(),
        companionName,
        content: diaryContent
      })
    } catch (err) {
      console.warn(`Failed to append diary for ${conversationId}:`, err)
    }
  }

  if (genFailures.length > 0) {
    console.warn(`Artifact generation failures for ${conversationId}:`, genFailures)
  }

  return {
    artifactCount,
    farewell: farewellContent,
    failures: genFailures.map((f) => f.type)
  }
}

async function readCompanionName(dataRoot: string, companionId: string): Promise<string | null> {
  try {
    const indexPath = join(companionDir(dataRoot), 'index.json')
    const content = await readFile(indexPath, 'utf-8')
    const companions = CompanionSchema.array().parse(JSON.parse(content)) as Array<{ id: string; name: string }>
    return companions.find((c) => c.id === companionId)?.name ?? null
  } catch {
    return null
  }
}
