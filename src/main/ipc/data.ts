import { ipcMain, dialog, BrowserWindow } from 'electron'
import { ConversationStore } from '../storage/conversation-store'
import { TextbookStore } from '../storage/textbook-store'
import { ArtifactStore } from '../storage/artifact-store'
import { ReadingNoteStore } from '../storage/reading-note-store'
import type { ProviderStore } from '../storage/provider-store'
import { generateArtifacts } from '../artifacts/generate'
import { extractText, getEpubChapters } from '../parsers'
import { PickedFileRegistry } from './picked-files'
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
  IpcGenerateArtifactInputSchema,
  IpcCreateArtifactInputSchema,
  IpcGetArtifactInputSchema,
  IpcListArtifactsInputSchema,
  IpcCreateTextbookFullInputSchema,
  IpcGetTextbookInputSchema,
  IpcListTextbooksInputSchema,
  IpcUpdateTextbookInputSchema,
  IpcUpdateTextbookProgressInputSchema,
  IpcDeleteTextbookInputSchema,
  IpcReadOriginalInputSchema,
  IpcReadEpubChaptersInputSchema,
  IpcCreateReadingNoteInputSchema,
  IpcListReadingNotesInputSchema,
  IpcUpdateReadingNoteInputSchema,
  IpcDeleteReadingNoteInputSchema,
  IpcWriteTextFileInputSchema,
  IpcOpenFileDialogInputSchema,
  IpcSaveFileDialogInputSchema
} from '../../shared/schemas/ipc'
import { ArtifactType, type WorldId, type ConversationId } from '../../shared/types/ids'

/** In-app reader loads the whole file into memory — cap it. */
const MAX_ORIGINAL_SIZE = 512 * 1024 * 1024

export function registerConversationIpc(
  dataRoot: string,
  providerStore?: ProviderStore
): { conversationStore: ConversationStore; textbookStore: TextbookStore; artifactStore: ArtifactStore; readingNoteStore: ReadingNoteStore } {
  const conversationStore = new ConversationStore(dataRoot)
  const textbookStore = new TextbookStore(dataRoot)
  const artifactStore = new ArtifactStore(dataRoot)
  const readingNoteStore = new ReadingNoteStore(dataRoot)
  const pickedFiles = new PickedFileRegistry()

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
    return conversationStore.delete(parsed.conversationId, worldId)
  })

  ipcMain.handle('conversation:update-title', async (_event, input: unknown) => {
    const parsed = IpcUpdateTitleInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    return conversationStore.updateTitle(parsed.conversationId, worldId, parsed.title)
  })

  ipcMain.handle('conversation:end', async (_event, input: unknown) => {
    const parsed = IpcEndClassInputSchema.parse(input)
    const { conversationId, worldId = 'world_default' } = parsed
    const success = await conversationStore.endConversation(conversationId, worldId)
    if (!success) return { success: false, artifacts: 0 }

    let artifactCount = 0
    try {
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

      if (apiKey) {
        const messages = await conversationStore.getMessages(conversationId, worldId)
        const { results, failures } = await generateArtifacts(messages, { apiKey, model, baseUrl })
        let progressContent = ''
        for (const result of results) {
          await artifactStore.create(conversationId as ConversationId, worldId as WorldId, result.type, result.content)
          artifactCount++
          if (result.type === ArtifactType.Progress) {
            progressContent = result.content
          }
        }

        // Writeback: save progress artifact content to textbook progress
        if (progressContent) {
          const conv = await conversationStore.get(conversationId, worldId)
          if (conv?.textbookId) {
            await textbookStore.updateProgress(conv.textbookId, worldId, {
              lastPosition: progressContent
            })
          }
        }

        if (failures.length > 0) {
          console.warn(`Artifact generation failures for ${conversationId}:`, failures)
        }
      }
    } catch (err) {
      console.error(`Artifact generation error for ${conversationId}:`, err)
    }

    return { success: true, artifacts: artifactCount }
  })

  ipcMain.handle('artifact:generate', async (_event, input: unknown) => {
    const parsed = IpcGenerateArtifactInputSchema.parse(input)
    const { conversationId, worldId = 'world_default' } = parsed

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

    if (!apiKey) return { count: 0, types: [] as string[] }

    const messages = await conversationStore.getMessages(conversationId, worldId)
    const { results } = await generateArtifacts(messages, { apiKey, model, baseUrl })

    for (const result of results) {
      await artifactStore.create(conversationId as ConversationId, worldId as WorldId, result.type, result.content)
    }

    return { count: results.length, types: results.map((r) => r.type) }
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
    return conversationStore.searchMessages(parsed.worldId, parsed.query)
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
    return result
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
    const { join } = await import('node:path')
    const { textbookDir } = await import('../storage/app-data')
    const parsed = IpcReadEpubChaptersInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    const textbook = await textbookStore.get(parsed.textbookId, worldId)
    if (!textbook || !textbook.originalFile) {
      throw new Error('Textbook not found or has no original file')
    }
    const fullPath = join(textbookDir(dataRoot, parsed.textbookId, worldId), textbook.originalFile)
    return getEpubChapters(fullPath)
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

  ipcMain.handle('artifact:list', async (_event, input: unknown) => {
    const parsed = IpcListArtifactsInputSchema.parse(input)
    const worldId = parsed.worldId ?? 'world_default'
    return artifactStore.list(parsed.conversationId, worldId)
  })

  // --- File I/O ---

  ipcMain.handle('file:writeText', async (_event, input: unknown) => {
    const parsed = IpcWriteTextFileInputSchema.parse(input)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(parsed.filePath, parsed.content, 'utf-8')
    return { success: true }
  })

  return { conversationStore, textbookStore, artifactStore, readingNoteStore }
}
