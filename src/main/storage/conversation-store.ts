import { mkdir, readFile, access, readdir, rm, appendFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Conversation } from '../../shared/schemas/conversation'
import { ConversationSchema } from '../../shared/schemas/conversation'
import type { Message } from '../../shared/schemas/message'
import { MessageSchema } from '../../shared/schemas/message'
import type { ConversationId, MessageId } from '../../shared/types/ids'
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
  companionId: string
  /** 创建会话时的人格版本快照（里程碑 2），缺失时 null。 */
  companionVersion: number | null
  textbookId: string | null
  title: string
}

let idCounter = 0

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
  // Caches the lowercased text of every message so repeated
  // searches don't re-read all JSONL files from disk.  Invalidated on any
  // write (addMessage / updateMessage / deleteMessage / delete).
  private indexCache: Map<string, Array<{ conversationId: string; messageId: string; text: string }>> = new Map()
  private indexDirty: Set<string> = new Set()

  /** Mark the index as stale so it is rebuilt on the next search. */
  private invalidateIndex(): void {
    this.indexCache.delete(this.dataRoot)
    this.indexDirty.add(this.dataRoot)
  }

  /**
   * Per-conversation write queue.
   *
   * addMessage appends JSONL while update/delete/truncate rewrite the whole
   * file — interleaved they can drop messages (a rewrite built from a
   * snapshot taken before a concurrent append silently erases it). Every
   * mutation goes through this queue so read-modify-write cycles are
   * serialized per conversation.
   */
  private writeQueues = new Map<string, Promise<void>>()

  private enqueueWrite<T>(conversationId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.writeQueues.get(conversationId) ?? Promise.resolve()
    const result = prev.then(task, task)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.writeQueues.set(conversationId, tail)
    void tail.then(() => {
      // Drop the queue entry once idle so the map cannot grow forever.
      if (this.writeQueues.get(conversationId) === tail) {
        this.writeQueues.delete(conversationId)
      }
    })
    return result
  }

  /** Build (or rebuild) the in-memory index. */
  private async buildIndex(): Promise<void> {
    const conversations = await this.list()
    const entries: Array<{ conversationId: string; messageId: string; text: string }> = []
    for (const conv of conversations) {
      const messages = await this.getMessages(conv.id)
      for (const msg of messages) {
        entries.push({ conversationId: conv.id, messageId: msg.id, text: msg.content.toLowerCase() })
      }
    }
    this.indexCache.set(this.dataRoot, entries)
    this.indexDirty.delete(this.dataRoot)
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    const now = new Date().toISOString()
    const id = generateId()

    const conversation = buildConversation(id, input, now)

    await mkdir(conversationDir(this.dataRoot, id, ), { recursive: true })
    await atomicWriteFile(
      conversationPath(this.dataRoot, id, ),
      JSON.stringify(conversation, null, 2),
      'utf-8'
    )
    await atomicWriteFile(
      conversationMessagesPath(this.dataRoot, id, ),
      '',
      'utf-8'
    )

    return conversation
  }

  async get(conversationId: string): Promise<Conversation | null> {
    try {
      const content = await readFile(
        conversationPath(this.dataRoot, conversationId),
        'utf-8'
      )
      const parsed = ConversationSchema.parse(JSON.parse(content))
      return parsed as unknown as Conversation
    } catch (err) {
      if (!isNotFoundError(err)) warnReadFailure(`conversation ${conversationId}`, err)
      return null
    }
  }

  async list(): Promise<Conversation[]> {
    try {
      await access(conversationsDir(this.dataRoot))
    } catch {
      return []
    }

    const entries = await readdir(conversationsDir(this.dataRoot))
    const conversations: Conversation[] = []

    for (const entry of entries) {
      const conv = await this.get(entry)
      if (conv) {
        conversations.push(conv)
      }
    }

    return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async delete(conversationId: string): Promise<boolean> {
    return this.enqueueWrite(conversationId, async () => {
      try {
        const dir = conversationDir(this.dataRoot, conversationId)
        await rm(dir, { recursive: true, force: true })
        this.invalidateIndex()
        return true
      } catch {
        /* v8 ignore next -- @preserve */
        return false
      }
    })
  }

  async addMessage(conversationId: string, role: string, content: string): Promise<Message> {
    return this.enqueueWrite(conversationId, async () => {
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
        conversationMessagesPath(this.dataRoot, conversationId),
        JSON.stringify(message) + '\n',
        'utf-8'
      )

      // Update conversation's updatedAt
      const conv = await this.get(conversationId)
      if (conv) {
        conv.updatedAt = now
        await atomicWriteFile(
          conversationPath(this.dataRoot, conversationId),
          JSON.stringify(conv, null, 2),
          'utf-8'
        )
      }

      // Incremental index update (avoid full rebuild)
      const idx = this.indexCache.get(this.dataRoot)
      if (idx) {
        idx.push({ conversationId, messageId: id, text: content.toLowerCase() })
      }

      return message
    })
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    try {
      const content = await readFile(
        conversationMessagesPath(this.dataRoot, conversationId),
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

  async endConversation(conversationId: string): Promise<boolean> {
    return this.enqueueWrite(conversationId, async () => {
      const conv = await this.get(conversationId)
      if (!conv) return false

      const now = new Date().toISOString()
      conv.endedAt = now
      conv.updatedAt = now

      await atomicWriteFile(
        conversationPath(this.dataRoot, conversationId),
        JSON.stringify(conv, null, 2),
        'utf-8'
      )
      return true
    })
  }

  async updateTitle(conversationId: string, title: string): Promise<Conversation | null> {
    return this.enqueueWrite(conversationId, async () => {
      const conv = await this.get(conversationId)
      if (!conv) return null

      conv.title = title
      conv.updatedAt = new Date().toISOString()

      await atomicWriteFile(
        conversationPath(this.dataRoot, conversationId),
        JSON.stringify(conv, null, 2),
        'utf-8'
      )
      return conv
    })
  }

  async updateMessage(conversationId: string, messageId: string, content: string): Promise<Message | null> {
    return this.enqueueWrite(conversationId, async () => {
      const messages = await this.getMessages(conversationId)
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return null
      messages[idx].content = content
      await this.writeMessages(conversationId, messages)
      this.invalidateIndex()
      return messages[idx]
    })
  }

  async deleteMessage(conversationId: string, messageId: string): Promise<boolean> {
    return this.enqueueWrite(conversationId, async () => {
      const messages = await this.getMessages(conversationId)
      const filtered = messages.filter((m) => m.id !== messageId)
      if (filtered.length === messages.length) return false
      await this.writeMessages(conversationId, filtered)
      this.invalidateIndex()
      return true
    })
  }

  /**
   * Rewind a conversation to a given message: keep everything up to and
   * including that message, drop the rest (3.0.0 "rewind the conversation").
   */
  async truncateAfter(
    conversationId: string,
    messageId: string
  ): Promise<boolean> {
    return this.enqueueWrite(conversationId, async () => {
      const messages = await this.getMessages(conversationId)
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return false
      const kept = messages.slice(0, idx + 1)
      if (kept.length === messages.length) return false
      await this.writeMessages(conversationId, kept)
      this.invalidateIndex()

      const conv = await this.get(conversationId)
      if (conv) {
        conv.updatedAt = new Date().toISOString()
        await atomicWriteFile(
          conversationPath(this.dataRoot, conversationId),
          JSON.stringify(conv, null, 2),
          'utf-8'
        )
      }
      return true
    })
  }

  async searchMessages(
    query: string,
    limit = 50,
    offset = 0
  ): Promise<SearchResult> {
    // Build / refresh index if needed
    if (!this.indexCache.has(this.dataRoot) || this.indexDirty.has(this.dataRoot)) {
      await this.buildIndex()
    }

    const index = this.indexCache.get(this.dataRoot) ?? []
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
      const messages = await this.getMessages(convId)
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

  private async writeMessages(conversationId: string, messages: Message[]): Promise<void> {
    const jsonl = messages.map((m) => JSON.stringify(m)).join('\n') + (messages.length > 0 ? '\n' : '')
    await atomicWriteFile(
      conversationMessagesPath(this.dataRoot, conversationId),
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
    
    companionId: input.companionId,
    companionVersion: input.companionVersion ?? null,
    textbookId: input.textbookId,
    title: input.title,
    createdAt: now,
    updatedAt: now,
    endedAt: null
  }
  return raw as unknown as Conversation
}
