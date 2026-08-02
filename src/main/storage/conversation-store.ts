import { mkdir, writeFile, readFile, access, readdir, rm, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
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
import { isNotFoundError, warnReadFailure } from './fs-errors'
import { atomicWriteFile } from './atomic-write'

const MessageRoleSchema = z.enum(['user', 'assistant', 'system'])

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

export interface SearchResult {
  results: Array<{ conversationId: string; message: Message }>
  total: number
}

export class ConversationStore {
  constructor(private readonly dataRoot: string) {}

  // ---- In-memory search index ----
  // Caches the lowercased text of every message per worldId so repeated
  // searches don't re-read all JSONL files from disk.  Invalidated on any
  // write (addMessage / updateMessage / deleteMessage / delete).
  private indexCache: Map<string, Array<{ conversationId: string; messageId: string; text: string }>> = new Map()
  private indexDirty: Set<string> = new Set()

  /** Mark a worldId's index as stale so it is rebuilt on the next search. */
  private invalidateIndex(worldId: string): void {
    this.indexCache.delete(worldId)
    this.indexDirty.add(worldId)
  }

  /** Build (or rebuild) the in-memory index for a worldId. */
  private async buildIndex(worldId: string): Promise<void> {
    const conversations = await this.list(worldId)
    const entries: Array<{ conversationId: string; messageId: string; text: string }> = []
    for (const conv of conversations) {
      const messages = await this.getMessages(conv.id, worldId)
      for (const msg of messages) {
        entries.push({ conversationId: conv.id, messageId: msg.id, text: msg.content.toLowerCase() })
      }
    }
    this.indexCache.set(worldId, entries)
    this.indexDirty.delete(worldId)
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    const now = new Date().toISOString()
    const id = generateId()

    const conversation = buildConversation(id, input, now)

    await mkdir(conversationDir(this.dataRoot, id, input.worldId), { recursive: true })
    await atomicWriteFile(
      conversationPath(this.dataRoot, id, input.worldId),
      JSON.stringify(conversation, null, 2),
      'utf-8'
    )
    await atomicWriteFile(
      conversationMessagesPath(this.dataRoot, id, input.worldId),
      '',
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
    } catch (err) {
      if (!isNotFoundError(err)) warnReadFailure(`conversation ${conversationId}`, err)
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
      await rm(dir, { recursive: true, force: true })
      this.invalidateIndex(worldId)
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

    await appendFile(
      conversationMessagesPath(this.dataRoot, conversationId, worldId),
      JSON.stringify(message) + '\n',
      'utf-8'
    )

    // Update conversation's updatedAt
    const conv = await this.get(conversationId, worldId)
    if (conv) {
      conv.updatedAt = now
      await atomicWriteFile(
        conversationPath(this.dataRoot, conversationId, worldId),
        JSON.stringify(conv, null, 2),
        'utf-8'
      )
    }

    // Incremental index update (avoid full rebuild)
    const idx = this.indexCache.get(worldId)
    if (idx) {
      idx.push({ conversationId, messageId: id, text: content.toLowerCase() })
    }

    return message
  }

  async getMessages(conversationId: string, worldId: string): Promise<Message[]> {
    try {
      const content = await readFile(
        conversationMessagesPath(this.dataRoot, conversationId, worldId),
        'utf-8'
      )
      const trimmed = content.trim()
      if (!trimmed) return []

      // Backward compatibility: old files stored a JSON array
      if (trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed)
        return MessageSchema.array().parse(parsed) as unknown as Message[]
      }

      // JSONL: one JSON object per line
      const lines = trimmed.split('\n')
      const messages: Message[] = []
      let skipped = 0
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = MessageSchema.parse(JSON.parse(line))
          messages.push(parsed as unknown as Message)
        } catch {
          skipped++
        }
      }
      if (skipped > 0) {
        console.warn(`[storage] Skipped ${skipped} malformed message line(s) in conversation ${conversationId}`)
      }
      return messages
    } catch (err) {
      // Without this, a corrupt messages file looks exactly like "no messages".
      if (!isNotFoundError(err)) warnReadFailure(`messages of conversation ${conversationId}`, err)
      return []
    }
  }

  async endConversation(conversationId: string, worldId: string): Promise<boolean> {
    const conv = await this.get(conversationId, worldId)
    if (!conv) return false

    const now = new Date().toISOString()
    conv.endedAt = now
    conv.updatedAt = now

    await atomicWriteFile(
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

    await atomicWriteFile(
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
    await this.writeMessages(conversationId, worldId, messages)
    this.invalidateIndex(worldId)
    return messages[idx]
  }

  async deleteMessage(conversationId: string, worldId: string, messageId: string): Promise<boolean> {
    const messages = await this.getMessages(conversationId, worldId)
    const filtered = messages.filter((m) => m.id !== messageId)
    if (filtered.length === messages.length) return false
    await this.writeMessages(conversationId, worldId, filtered)
    this.invalidateIndex(worldId)
    return true
  }

  /**
   * Rewind a conversation to a given message: keep everything up to and
   * including that message, drop the rest (3.0.0 "rewind the conversation").
   */
  async truncateAfter(
    conversationId: string,
    worldId: string,
    messageId: string
  ): Promise<boolean> {
    const messages = await this.getMessages(conversationId, worldId)
    const idx = messages.findIndex((m) => m.id === messageId)
    if (idx === -1) return false
    const kept = messages.slice(0, idx + 1)
    if (kept.length === messages.length) return false
    await this.writeMessages(conversationId, worldId, kept)
    this.invalidateIndex(worldId)

    const conv = await this.get(conversationId, worldId)
    if (conv) {
      conv.updatedAt = new Date().toISOString()
      await atomicWriteFile(
        conversationPath(this.dataRoot, conversationId, worldId),
        JSON.stringify(conv, null, 2),
        'utf-8'
      )
    }
    return true
  }

  async searchMessages(
    worldId: string,
    query: string,
    limit = 50,
    offset = 0
  ): Promise<SearchResult> {
    // Build / refresh index if needed
    if (!this.indexCache.has(worldId) || this.indexDirty.has(worldId)) {
      await this.buildIndex(worldId)
    }

    const index = this.indexCache.get(worldId) ?? []
    const lowerQuery = query.toLowerCase()
    const matched: Array<{ conversationId: string; message: Message }> = []

    // We need the full Message objects for results, but we only want to
    // load messages for conversations that actually have matches.  So
    // first scan the index to find which conversations hit, then batch-
    // load only those.
    const hitsByConv = new Map<string, Set<string>>()
    for (const entry of index) {
      if (entry.text.includes(lowerQuery)) {
        let set = hitsByConv.get(entry.conversationId)
        if (!set) { set = new Set(); hitsByConv.set(entry.conversationId, set) }
        set.add(entry.messageId)
      }
    }

    // Load messages for hit conversations in order, applying offset/limit
    let skipped = 0
    let taken = 0
    for (const [convId, msgIds] of hitsByConv) {
      if (taken >= limit) break
      const messages = await this.getMessages(convId, worldId)
      for (const msg of messages) {
        if (!msgIds.has(msg.id)) continue
        if (!msg.content.toLowerCase().includes(lowerQuery)) continue
        if (skipped < offset) { skipped++; continue }
        matched.push({ conversationId: convId, message: msg })
        taken++
        if (taken >= limit) break
      }
    }

    // Total count (for pagination UI) - cheap because we already scanned
    const total = Array.from(hitsByConv.values()).reduce((sum, ids) => sum + ids.size, 0)

    return { results: matched, total }
  }

  private async writeMessages(conversationId: string, worldId: string, messages: Message[]): Promise<void> {
    const jsonl = messages.map((m) => JSON.stringify(m)).join('\n') + (messages.length > 0 ? '\n' : '')
    await atomicWriteFile(
      conversationMessagesPath(this.dataRoot, conversationId, worldId),
      jsonl,
      'utf-8'
    )
  }
}

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
