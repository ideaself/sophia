import { ipcMain, dialog, BrowserWindow } from 'electron'
import { ConversationStore } from '../storage/conversation-store'
import { TextbookStore } from '../storage/textbook-store'
import { ArtifactStore } from '../storage/artifact-store'
import { generateArtifacts } from '../artifacts/generate'
import { extractText } from '../parsers'
import {
  IpcCreateConversationInputSchema,
  IpcGetConversationInputSchema,
  IpcListConversationsInputSchema,
  IpcDeleteConversationInputSchema,
  IpcSendMessageInputSchema,
  IpcGetMessagesInputSchema,
  IpcSearchMessagesInputSchema
} from '../../shared/schemas/ipc'
import type { WorldId } from '../../shared/types/ids'

export function registerConversationIpc(
  dataRoot: string
): { conversationStore: ConversationStore; textbookStore: TextbookStore; artifactStore: ArtifactStore } {
  const conversationStore = new ConversationStore(dataRoot)
  const textbookStore = new TextbookStore(dataRoot)
  const artifactStore = new ArtifactStore(dataRoot)

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
    const parsed = IpcGetConversationInputSchema.parse(input)
    const worldId = (input as { worldId?: string }).worldId ?? 'world_default'
    const conv = await conversationStore.get(parsed.conversationId, worldId)
    return conv
  })

  ipcMain.handle('conversation:list', async (_event, input: unknown) => {
    const parsed = IpcListConversationsInputSchema.parse(input)
    return conversationStore.list(parsed.worldId)
  })

  ipcMain.handle('conversation:delete', async (_event, input: unknown) => {
    const parsed = IpcDeleteConversationInputSchema.parse(input)
    const worldId = (input as { worldId?: string }).worldId ?? 'world_default'
    return conversationStore.delete(parsed.conversationId, worldId)
  })

  ipcMain.handle('conversation:update-title', async (_event, input: unknown) => {
    const { conversationId, title, worldId = 'world_default' } = input as {
      conversationId: string
      title: string
      worldId?: string
    }
    return conversationStore.updateTitle(conversationId, worldId, title)
  })

  ipcMain.handle('conversation:end', async (_event, input: unknown) => {
    const { conversationId, worldId = 'world_default' } = input as { conversationId: string; worldId?: string }
    const success = await conversationStore.endConversation(conversationId, worldId)
    if (!success) return { success: false, artifacts: 0 }

    // Generate artifacts automatically (best-effort)
    let artifactCount = 0
    try {
      // Get API key from keychain
      const { safeStorage } = require('electron') as typeof import('electron')
      const { readFileSync } = require('node:fs') as typeof import('node:fs')
      const { join } = require('node:path') as typeof import('node:path')
      const keyPath = join(dataRoot, '.deepseek-key.enc')
      let apiKey = ''
      try {
        const encrypted = readFileSync(keyPath)
        apiKey = safeStorage.decryptString(encrypted)
      } catch {
        // No key stored
      }

      if (apiKey) {
        const messages = await conversationStore.getMessages(conversationId, worldId)
        const results = await generateArtifacts(messages, apiKey)
        for (const result of results) {
          await artifactStore.create(conversationId as any, worldId as WorldId, result.type, result.content)
          artifactCount++
        }
      }
    } catch {
      // Best-effort: don't fail end-class if artifact generation fails
    }

    return { success: true, artifacts: artifactCount }
  })

  ipcMain.handle('artifact:generate', async (_event, input: unknown) => {
    const { conversationId, worldId = 'world_default', apiKey } = input as {
      conversationId: string
      worldId?: string
      apiKey: string
    }
    const messages = await conversationStore.getMessages(conversationId, worldId)
    const results = await generateArtifacts(messages, apiKey)

    // Save generated artifacts
    for (const result of results) {
      await artifactStore.create(conversationId as any, worldId as WorldId, result.type, result.content)
    }

    return { count: results.length, types: results.map((r) => r.type) }
  })

  // --- Messages ---

  ipcMain.handle('message:send', async (_event, input: unknown) => {
    const parsed = IpcSendMessageInputSchema.parse(input)
    const worldId = (input as { worldId?: string }).worldId ?? 'world_default'
    const role = (input as { role?: string }).role ?? 'user'
    const msg = await conversationStore.addMessage(parsed.conversationId, worldId, role, parsed.content)
    return msg
  })

  ipcMain.handle('message:list', async (_event, input: unknown) => {
    const parsed = IpcGetMessagesInputSchema.parse(input)
    const worldId = (input as { worldId?: string }).worldId ?? 'world_default'
    return conversationStore.getMessages(parsed.conversationId, worldId)
  })

  ipcMain.handle('message:search', async (_event, input: unknown) => {
    const parsed = IpcSearchMessagesInputSchema.parse(input)
    return conversationStore.searchMessages(parsed.worldId, parsed.query)
  })

  // --- File Dialog ---

  ipcMain.handle('dialog:openFile', async (_event, input?: unknown) => {
    const options = (input ?? {}) as {
      filters?: Array<{ name: string; extensions: string[] }>
    }
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
    return result
  })

  // --- Textbook CRUD ---

  ipcMain.handle('textbook:create', async (_event, input: unknown) => {
    const parsed = (input as {
      worldId: string
      title: string
      format: 'markdown' | 'text' | 'pdf' | 'epub'
      sourceFile?: string
      content?: string
    })

    let content = parsed.content ?? ''

    // For pdf/epub, parse the file to extract text
    if ((parsed.format === 'pdf' || parsed.format === 'epub') && parsed.sourceFile) {
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
      format: parsed.format,
      sourceFile: parsed.sourceFile,
      content
    })
  })

  ipcMain.handle('textbook:get', async (_event, input: unknown) => {
    const parsed = input as { textbookId: string; worldId?: string }
    const worldId = parsed.worldId ?? 'world_default'
    return textbookStore.get(parsed.textbookId, worldId)
  })

  ipcMain.handle('textbook:list', async (_event, input: unknown) => {
    const parsed = input as { worldId: string }
    return textbookStore.list(parsed.worldId)
  })

  ipcMain.handle('textbook:update-content', async (_event, input: unknown) => {
    const parsed = input as { textbookId: string; worldId?: string; content: string }
    const worldId = parsed.worldId ?? 'world_default'
    return textbookStore.updateContent(parsed.textbookId, worldId, parsed.content)
  })

  ipcMain.handle('textbook:update', async (_event, input: unknown) => {
    const parsed = input as { textbookId: string; worldId?: string; title?: string; content?: string }
    const worldId = parsed.worldId ?? 'world_default'
    return textbookStore.update(parsed.textbookId, worldId, { title: parsed.title, content: parsed.content })
  })

  ipcMain.handle('textbook:delete', async (_event, input: unknown) => {
    const parsed = input as { textbookId: string; worldId?: string }
    const worldId = parsed.worldId ?? 'world_default'
    return textbookStore.delete(parsed.textbookId, worldId)
  })

  // --- Artifact CRUD ---

  ipcMain.handle('artifact:create', async (_event, input: unknown) => {
    const parsed = input as {
      conversationId: string
      worldId?: string
      type: 'lesson_summary' | 'flashcards' | 'diary' | 'progress' | 'handoff_tail'
      content: string
    }
    const worldId = parsed.worldId ?? 'world_default'
    return artifactStore.create(
      parsed.conversationId as any,
      worldId as WorldId,
      parsed.type as any,
      parsed.content
    )
  })

  ipcMain.handle('artifact:get', async (_event, input: unknown) => {
    const parsed = input as { artifactId: string; conversationId: string; worldId?: string }
    const worldId = parsed.worldId ?? 'world_default'
    return artifactStore.get(parsed.artifactId, parsed.conversationId, worldId)
  })

  ipcMain.handle('artifact:list', async (_event, input: unknown) => {
    const parsed = input as { conversationId: string; worldId?: string }
    const worldId = parsed.worldId ?? 'world_default'
    return artifactStore.list(parsed.conversationId, worldId)
  })

  return { conversationStore, textbookStore, artifactStore }
}
