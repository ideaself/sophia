import { ipcMain, dialog, BrowserWindow } from 'electron'
import { join, dirname } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { CompanionSchema } from '../../shared/schemas/companion'
import { readWorldData } from '../storage/world-store'
import { ConversationStore } from '../storage/conversation-store'
import { TextbookStore } from '../storage/textbook-store'
import { ArtifactStore } from '../storage/artifact-store'
import { ReadingNoteStore } from '../storage/reading-note-store'
import { DiaryStore } from '../storage/diary-store'
import type { ProviderStore } from '../storage/provider-store'
import { generateArtifacts } from '../artifacts/generate'
import { parseFlashcards, rebuildArtifactContent } from '../../shared/flashcard-utils'
import { extractText, getEpubChapters } from '../parsers'
import { splitSections, headingMatches } from '../prompt/textbook-retrieval'
import { DeepSeekClient } from '../llm/deepseek-client'
import { createDeepSeekHttpAdapter } from '../llm/deepseek-http-adapter'
import { PickedFileRegistry } from './picked-files'
import { createBackupZip } from '../backup/backup'
import {
  learnerPath,
  palMomentsPath,
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
  IpcGetConversationWithWorldInputSchema,
  IpcListConversationsInputSchema,
  IpcDeleteConversationInputSchema,
  IpcDeleteConversationWithWorldInputSchema,
  IpcUpdateTitleInputSchema,
  IpcEndClassInputSchema,
  IpcSendMessageWithWorldInputSchema,
  IpcGetMessagesWithWorldInputSchema,
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
  IpcScreenshotInputSchema
} from '../../shared/schemas/ipc'
import {
  ArtifactType,
  type ClassMode,
  type WorldId,
  type ConversationId
} from '../../shared/types/ids'
import { ARTIFACTS_GENERATED } from '../../shared/channel-names'

/** In-app reader loads the whole file into memory — cap it. */
const MAX_ORIGINAL_SIZE = 512 * 1024 * 1024

/** Structured handoff metadata persisted to handoff_meta.json. */
interface HandoffMetaEntry {
  savedAt: string
  prevConvId: string
  companionName: string
  companionSlot: 'a' | 'b' | 'c' | null
  endingPage: number | null
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
    worldId: string,
    classMode?: ClassMode
  ): void {
    artifactQueue = artifactQueue.then(async () => {
      try {
        const pipeline = await runArtifactPipeline(
          { dataRoot, providerStore, conversationStore, textbookStore, artifactStore, diaryStore },
          conversationId,
          worldId,
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
      worldId: parsed.worldId as WorldId,
      companionId: parsed.companionId,
      textbookId: parsed.textbookId ?? null,
      title: parsed.title
    })
    return conv
  })

  ipcMain.handle('conversation:get', async (_event, input: unknown) => {
    const parsed = IpcGetConversationWithWorldInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    return conversationStore.get(parsed.conversationId, worldId)
  })

  ipcMain.handle('conversation:list', async (_event, input: unknown) => {
    const parsed = IpcListConversationsInputSchema.parse(input)
    return conversationStore.list(parsed.worldId)
  })

  ipcMain.handle('conversation:delete', async (_event, input: unknown) => {
    const parsed = IpcDeleteConversationWithWorldInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    // Archive before deleting so the class can be restored (4.0.1).
    try {
      const conv = await conversationStore.get(parsed.conversationId, worldId)
      await archiveItem(
        dataRoot,
        'conversation',
        parsed.conversationId,
        conversationDir(dataRoot, parsed.conversationId, worldId),
        conv?.title ?? parsed.conversationId
      )
    } catch (err) {
      console.warn(`Archive conversation ${parsed.conversationId} failed:`, err)
    }
    return conversationStore.delete(parsed.conversationId, worldId)
  })

  ipcMain.handle('conversation:update-title', async (_event, input: unknown) => {
    const parsed = IpcUpdateTitleInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    return conversationStore.updateTitle(parsed.conversationId, worldId, parsed.title)
  })

  // Rewind a conversation to a message: drop everything after it
  ipcMain.handle('conversation:truncate', async (_event, input: unknown) => {
    const parsed = IpcTruncateConversationInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    return conversationStore.truncateAfter(
      parsed.conversationId,
      worldId,
      parsed.messageId
    )
  })

  ipcMain.handle('conversation:end', async (_event, input: unknown) => {
    const parsed = IpcEndClassInputSchema.parse(input)
    const { conversationId, worldId = 'world_default', classMode } = parsed
    const success = await conversationStore.endConversation(conversationId, worldId)
    if (!success) return { success: false, artifacts: 0 }
    // Generate artifacts in the background; the renderer is notified via
    // ARTIFACTS_GENERATED when the results are ready.
    queueArtifactGeneration(conversationId, worldId, classMode)
    return { success: true, artifacts: 0, farewell: '', failures: [], pending: true }
  })

  // Re-run only the artifact types that failed or went missing earlier
  // (4.0.0 "post-class updates can be run again — redo only the missing work").
  ipcMain.handle('conversation:redo-artifacts', async (_event, input: unknown) => {
    const parsed = IpcRedoArtifactsInputSchema.parse(input)
    const { conversationId, worldId = 'world_default', types } = parsed

    const knownTypes = new Set<string>(Object.values(ArtifactType))
    const validTypes = types.filter((t): t is ArtifactType => knownTypes.has(t))
    if (validTypes.length === 0) return { success: false, artifacts: 0, types: [] as string[] }

    try {
      const pipeline = await runArtifactPipeline(
        { dataRoot, providerStore, conversationStore, textbookStore, artifactStore, diaryStore },
        conversationId,
        worldId,
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

  ipcMain.handle('message:send', async (_event, input: unknown) => {
    const parsed = IpcSendMessageWithWorldInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    const role = parsed.role ?? 'user'
    const msg = await conversationStore.addMessage(parsed.conversationId, worldId, role, parsed.content)
    return msg
  })

  ipcMain.handle('message:list', async (_event, input: unknown) => {
    const parsed = IpcGetMessagesWithWorldInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    return conversationStore.getMessages(parsed.conversationId, worldId)
  })

  ipcMain.handle('message:search', async (_event, input: unknown) => {
    const parsed = IpcSearchMessagesInputSchema.parse(input)
    return conversationStore.searchMessages(
      parsed.worldId,
      parsed.query,
      parsed.limit,
      parsed.offset
    )
  })

  ipcMain.handle('message:update', async (_event, input: unknown) => {
    const parsed = IpcUpdateMessageInputSchema.parse(input)
    const wId = parsed.worldId ?? 'world_default'
    return conversationStore.updateMessage(parsed.conversationId, wId, parsed.messageId, parsed.content)
  })

  ipcMain.handle('message:delete', async (_event, input: unknown) => {
    const parsed = IpcDeleteMessageInputSchema.parse(input)
    const wId = parsed.worldId ?? 'world_default'
    return conversationStore.deleteMessage(parsed.conversationId, wId, parsed.messageId)
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
    let author = parsed.author ?? ''
    let description = parsed.description ?? ''

    if ((parsed.format === 'pdf' || parsed.format === 'epub') && parsed.sourceFile) {
      if (!pickedFiles.has(parsed.sourceFile)) {
        throw new Error('Source file must be selected through the file dialog')
      }
      try {
        const result = await extractText(parsed.sourceFile)
        content = result.content
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Failed to parse ${parsed.format.toUpperCase()} file: ${message}`)
      }
    }

    return textbookStore.create({
      worldId: parsed.worldId as WorldId,
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
    const worldId = parsed.worldId ?? 'world_default'
    return textbookStore.get(parsed.textbookId, worldId)
  })

  ipcMain.handle('textbook:read-original', async (_event, input: unknown) => {
    const parsed = IpcReadOriginalInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    const result = await textbookStore.readOriginal(parsed.textbookId, worldId)
    if (!result) return null
    if (result.data.length > MAX_ORIGINAL_SIZE) {
      throw new Error('原件超过 512MB，无法在应用内打开')
    }
    return { data: result.data, fileName: result.fileName }
  })

  ipcMain.handle('epub:read-chapters', async (_event, input: unknown) => {
    const parsed = IpcReadEpubChaptersInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    const textbook = await textbookStore.get(parsed.textbookId, worldId)
    if (!textbook || !textbook.originalFile) {
      throw new Error('Textbook not found or has no original file')
    }
    const fullPath = join(textbookDir(dataRoot, parsed.textbookId, worldId), textbook.originalFile)
    return getEpubChapters(fullPath)
  })

  // Look up the real textbook passage for a chat citation chip
  ipcMain.handle('textbook:search-excerpt', async (_event, input: unknown) => {
    const parsed = IpcTextbookSearchExcerptInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    const content = await textbookStore.getContent(parsed.textbookId, worldId)
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
    const worldId = parsed.worldId ?? 'world_default'
    const content = await textbookStore.getContent(parsed.textbookId, worldId)
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

  ipcMain.handle('textbook:list', async (_event, input: unknown) => {
    const parsed = IpcListTextbooksInputSchema.parse(input)
    return textbookStore.list(parsed.worldId)
  })

  ipcMain.handle('textbook:update', async (_event, input: unknown) => {
    const parsed = IpcUpdateTextbookInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    return textbookStore.update(parsed.textbookId, worldId, parsed)
  })

  ipcMain.handle('textbook:update-progress', async (_event, input: unknown) => {
    const parsed = IpcUpdateTextbookProgressInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    return textbookStore.updateProgress(parsed.textbookId, worldId, parsed)
  })

  ipcMain.handle('textbook:delete', async (_event, input: unknown) => {
    const parsed = IpcDeleteTextbookInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    // Archive the textbook (source + notes + reading progress) before deleting (4.0.1).
    try {
      const tb = await textbookStore.get(parsed.textbookId, worldId)
      await archiveItem(
        dataRoot,
        'textbook',
        parsed.textbookId,
        textbookDir(dataRoot, parsed.textbookId, worldId),
        tb?.title ?? parsed.textbookId
      )
    } catch (err) {
      console.warn(`Archive textbook ${parsed.textbookId} failed:`, err)
    }
    return textbookStore.delete(parsed.textbookId, worldId)
  })

  // --- Reading Notes ---

  ipcMain.handle('reading-note:create', async (_event, input: unknown) => {
    const parsed = IpcCreateReadingNoteInputSchema.parse(input)
    return readingNoteStore.create({
      ...parsed,
      worldId: parsed.worldId ?? 'world_default'
    })
  })

  ipcMain.handle('reading-note:list', async (_event, input: unknown) => {
    const parsed = IpcListReadingNotesInputSchema.parse(input)
    return readingNoteStore.list(parsed.textbookId, parsed.worldId ?? 'world_default')
  })

  ipcMain.handle('reading-note:update', async (_event, input: unknown) => {
    const parsed = IpcUpdateReadingNoteInputSchema.parse(input)
    return readingNoteStore.update(parsed.noteId, parsed.textbookId, parsed.worldId ?? 'world_default', parsed)
  })

  ipcMain.handle('reading-note:delete', async (_event, input: unknown) => {
    const parsed = IpcDeleteReadingNoteInputSchema.parse(input)
    return readingNoteStore.delete(parsed.noteId, parsed.textbookId, parsed.worldId ?? 'world_default')
  })

  // --- Artifact CRUD ---

  ipcMain.handle('artifact:create', async (_event, input: unknown) => {
    const parsed = IpcCreateArtifactInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    return artifactStore.create(
      parsed.conversationId as ConversationId,
      worldId as WorldId,
      parsed.type,
      parsed.content
    )
  })

  ipcMain.handle('artifact:get', async (_event, input: unknown) => {
    const parsed = IpcGetArtifactInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    return artifactStore.get(parsed.artifactId, parsed.conversationId, worldId)
  })

  ipcMain.handle('artifact:update', async (_event, input: unknown) => {
    const parsed = IpcUpdateArtifactInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    return artifactStore.update(
      parsed.artifactId,
      parsed.conversationId,
      worldId,
      parsed.content
    )
  })

  ipcMain.handle('artifact:list', async (_event, input: unknown) => {
    const parsed = IpcListArtifactsInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    return artifactStore.list(parsed.conversationId, worldId)
  })

  // --- File I/O ---

  ipcMain.handle('file:writeText', async (_event, input: unknown) => {
    const parsed = IpcWriteTextFileInputSchema.parse(input)
    if (!pickedFiles.has(parsed.filePath)) {
      throw new Error('Target file must be selected through the save dialog')
    }
    await writeFile(parsed.filePath, parsed.content, 'utf-8')
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
      await writeFile(parsed.filePath, pdf)
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
    await writeFile(parsed.filePath, image.toPNG())
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
    await writeFile(srsStatePath, JSON.stringify(input), 'utf-8')
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
    await writeFile(favoritesPath, JSON.stringify(Array.isArray(input) ? input : []), 'utf-8')
    return { success: true }
  })

  // Batch-delete specific cards across flashcards artifacts (2.0.0).
  ipcMain.handle('flashcard:delete-cards', async (_event, input: unknown) => {
    const parsed = IpcFlashcardDeleteCardsInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
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
      const artifact = await artifactStore.get(entry.artifactId, entry.conversationId, worldId)
      if (!artifact) continue
      const cards = parseFlashcards(artifact.content)
      const remove = new Set(entry.indexes)
      const kept = cards.filter((_, i) => !remove.has(i))
      if (kept.length === cards.length) continue
      if (kept.length === 0) {
        await artifactStore.update(entry.artifactId, entry.conversationId, worldId, '')
      } else {
        await artifactStore.update(entry.artifactId, entry.conversationId, worldId, rebuildArtifactContent(kept))
      }
      deleted += cards.length - kept.length
    }
    return { success: true, deleted }
  })

  // --- Diary (monthly files) ---

  ipcMain.handle('diary:list-months', async (_event, input: unknown) => {
    const parsed = IpcDiaryListMonthsInputSchema.parse(input)
    return diaryStore.listMonths(parsed.worldId)
  })

  ipcMain.handle('diary:get-month', async (_event, input: unknown) => {
    const parsed = IpcDiaryGetMonthInputSchema.parse(input)
    return diaryStore.getMonth(parsed.worldId, parsed.month)
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
  worldId: string,
  options: { classMode?: ClassMode; types?: ArtifactType[] } = {}
): Promise<ArtifactPipelineResult> {
  const { dataRoot, providerStore, conversationStore, textbookStore, artifactStore, diaryStore } = deps
  const { classMode, types } = options

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

  const messages = await conversationStore.getMessages(conversationId, worldId)
  const { results, failures: genFailures } = await generateArtifacts(
    messages,
    { apiKey, model, baseUrl },
    { classMode, types }
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
      worldId as WorldId,
      result.type,
      result.content
    )
    artifactCount++
    if (result.type === ArtifactType.Progress) progressContent = result.content
    if (result.type === ArtifactType.HandoffTail) handoffTailContent = result.content
    if (result.type === ArtifactType.Diary) diaryContent = result.content
  }

  // Load conversation to get companionId / textbookId for writebacks
  const conv = await conversationStore.get(conversationId, worldId)

  // Writeback: save progress artifact content to textbook progress
  if (progressContent && conv?.textbookId) {
    try {
      await textbookStore.updateProgress(conv.textbookId, worldId, {
        lastPosition: progressContent
      })
    } catch (err) {
      console.warn(`Failed to write textbook progress for ${conversationId}:`, err)
    }
  }

  // Writeback: save learner profile to learner.md
  if (learnerProfileContent) {
    try {
      await writeFile(learnerPath(dataRoot, worldId), learnerProfileContent, 'utf-8')
    } catch (err) {
      console.warn(`Failed to write learner profile for ${conversationId}:`, err)
    }
  }

  // Writeback: prepend pal moments entry to pal_moments.md
  if (palMomentsContent) {
    try {
      const filePath = palMomentsPath(dataRoot, worldId)
      let existing = ''
      try { existing = await readFile(filePath, 'utf-8') } catch { /* file doesn't exist yet */ }
      const merged = palMomentsContent + (existing ? '\n\n---\n\n' + existing : '')
      await writeFile(filePath, merged, 'utf-8')
    } catch (err) {
      console.warn(`Failed to write pal moments for ${conversationId}:`, err)
    }
  }

  // Writeback: save relation state to relation_{companionId}.md
  if (relationContent && conv?.companionId) {
    try {
      await writeFile(
        relationPath(dataRoot, conv.companionId, worldId),
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
      const filePath = handoffMetaPath(dataRoot, worldId)
      let meta: Record<string, HandoffMetaEntry> = {}
      try { meta = JSON.parse(await readFile(filePath, 'utf-8')) } catch { /* no meta yet */ }
      const worldData = await readWorldData(dataRoot, worldId)
      const slots = worldData?.world.companionSlots ?? { a: null, b: null, c: null }
      const slot = (Object.entries(slots).find(([, id]) => id === conv.companionId)?.[0] ?? null) as 'a' | 'b' | 'c' | null
      const companionName = (await readCompanionName(dataRoot, conv.companionId)) ?? conv.companionId
      let endingPage: number | null = null
      if (conv.textbookId) {
        const tb = await textbookStore.get(conv.textbookId, worldId)
        endingPage = tb?.progress.currentPage ?? null
      }
      meta[conv.companionId] = {
        savedAt: new Date().toISOString(),
        prevConvId: conversationId,
        companionName,
        companionSlot: slot,
        endingPage
      }
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(meta, null, 2), 'utf-8')
    } catch (err) {
      console.warn(`Failed to write handoff meta for ${conversationId}:`, err)
    }
  }

  // Writeback: append the diary to the monthly diary file (diary/YYYY-MM.md)
  if (diaryContent && conv) {
    try {
      const companionName = (await readCompanionName(dataRoot, conv.companionId)) ?? conv.companionId
      await diaryStore.append(worldId, {
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
