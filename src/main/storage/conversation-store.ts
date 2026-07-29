import { mkdir, writeFile, readFile, access, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Conversation } from '../../shared/schemas/conversation'
import { ConversationSchema } from '../../shared/schemas/conversation'
import type { Message } from '../../shared/schemas/message'
import { MessageSchema } from '../../shared/schemas/message'
import type { ConversationId, WorldId, CompanionId, TextbookId, MessageId } from '../../shared/types/ids'
import {
  conversationsDir,
  conversationDir,
  conversationPath,
  conversationMessagesPath
} from './app-data'

export interface CreateConversationInput {
  worldId: WorldId
  companionId: string
  textbookId: string | null
  title: string
}

let idCounter = 0

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-constraint
function generateId(): ConversationId {
  idCounter += 1
  return `conv_${Date.now()}_${idCounter}` as ConversationId
}

export class ConversationStore {
  constructor(private readonly dataRoot: string) {}

  async create(input: CreateConversationInput): Promise<Conversation> {
    const now = new Date().toISOString()
    const id = generateId()

    const conversation = buildConversation(id, input, now)

    await mkdir(conversationDir(this.dataRoot, id, input.worldId), { recursive: true })
    await writeFile(
      conversationPath(this.dataRoot, id, input.worldId),
      JSON.stringify(conversation, null, 2),
      'utf-8'
    )
    await writeFile(
      conversationMessagesPath(this.dataRoot, id, input.worldId),
      JSON.stringify([], null, 2),
      'utf-8'
    )

    return conversation
  }

  async get(conversationId: string, worldId: string): Promise<Conversation | null> {
    try {
      const content = await readFile(
        conversationPath(this.dataRoot, conversationId, worldId),
        'utf-8'
      )
      const parsed = ConversationSchema.parse(JSON.parse(content))
      return parsed as unknown as Conversation
    } catch {
      return null
    }
  }

  async list(worldId: string): Promise<Conversation[]> {
    try {
      await access(conversationsDir(this.dataRoot, worldId))
    } catch {
      return []
    }

    const entries = await readdir(conversationsDir(this.dataRoot, worldId))
    const conversations: Conversation[] = []

    for (const entry of entries) {
      const conv = await this.get(entry, worldId)
      if (conv) {
        conversations.push(conv)
      }
    }

    return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async delete(conversationId: string, worldId: string): Promise<boolean> {
    try {
      const dir = conversationDir(this.dataRoot, conversationId, worldId)
      await access(dir)
      // Remove conversation.json, messages.json, and artifacts/
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

  async addMessage(conversationId: string, worldId: string, role: string, content: string): Promise<Message> {
    const now = new Date().toISOString()
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` as unknown as MessageId

    const rawMsg: Record<string, unknown> = {
      id,
      conversationId,
      role: MessageRoleSchema.parse(role),
      content,
      createdAt: now
    }
    const message = rawMsg as unknown as Message

    const messages = await this.getMessages(conversationId, worldId)
    messages.push(message)

    await writeFile(
      conversationMessagesPath(this.dataRoot, conversationId, worldId),
      JSON.stringify(messages, null, 2),
      'utf-8'
    )

    // Update conversation's updatedAt
    const conv = await this.get(conversationId, worldId)
    if (conv) {
      conv.updatedAt = now
      await writeFile(
        conversationPath(this.dataRoot, conversationId, worldId),
        JSON.stringify(conv, null, 2),
        'utf-8'
      )
    }

    return message
  }

  async getMessages(conversationId: string, worldId: string): Promise<Message[]> {
    try {
      const content = await readFile(
        conversationMessagesPath(this.dataRoot, conversationId, worldId),
        'utf-8'
      )
      const parsed = JSON.parse(content)
      return MessageSchema.array().parse(parsed) as unknown as Message[]
    } catch {
      return []
    }
  }

  async endConversation(conversationId: string, worldId: string): Promise<boolean> {
    const conv = await this.get(conversationId, worldId)
    if (!conv) return false

    const now = new Date().toISOString()
    conv.endedAt = now
    conv.updatedAt = now

    await writeFile(
      conversationPath(this.dataRoot, conversationId, worldId),
      JSON.stringify(conv, null, 2),
      'utf-8'
    )
    return true
  }

  async updateTitle(conversationId: string, worldId: string, title: string): Promise<Conversation | null> {
    const conv = await this.get(conversationId, worldId)
    if (!conv) return null

    conv.title = title
    conv.updatedAt = new Date().toISOString()

    await writeFile(
      conversationPath(this.dataRoot, conversationId, worldId),
      JSON.stringify(conv, null, 2),
      'utf-8'
    )
    return conv
  }

  async updateMessage(conversationId: string, worldId: string, messageId: string, content: string): Promise<Message | null> {
    const messages = await this.getMessages(conversationId, worldId)
    const idx = messages.findIndex((m) => m.id === messageId)
    if (idx === -1) return null
    messages[idx].content = content
    await writeFile(
      conversationMessagesPath(this.dataRoot, conversationId, worldId),
      JSON.stringify(messages, null, 2),
      'utf-8'
    )
    return messages[idx]
  }

  async deleteMessage(conversationId: string, worldId: string, messageId: string): Promise<boolean> {
    const messages = await this.getMessages(conversationId, worldId)
    const filtered = messages.filter((m) => m.id !== messageId)
    if (filtered.length === messages.length) return false
    await writeFile(
      conversationMessagesPath(this.dataRoot, conversationId, worldId),
      JSON.stringify(filtered, null, 2),
      'utf-8'
    )
    return true
  }

  async searchMessages(worldId: string, query: string): Promise<Array<{ conversationId: string; message: Message }>> {
    const conversations = await this.list(worldId)
    const results: Array<{ conversationId: string; message: Message }> = []
    const lowerQuery = query.toLowerCase()

    for (const conv of conversations) {
      const messages = await this.getMessages(conv.id, worldId)
      for (const msg of messages) {
        if (msg.content.toLowerCase().includes(lowerQuery)) {
          results.push({ conversationId: conv.id, message: msg })
        }
      }
    }

    return results
  }
}

import { z } from 'zod'
const MessageRoleSchema = z.enum(['user', 'assistant', 'system'])

function buildConversation(
  id: ConversationId,
  input: CreateConversationInput,
  now: string
): Conversation {
  const raw: Record<string, unknown> = {
    id,
    worldId: input.worldId,
    companionId: input.companionId,
    textbookId: input.textbookId,
    title: input.title,
    createdAt: now,
    updatedAt: now,
    endedAt: null
  }
  return raw as unknown as Conversation
}
