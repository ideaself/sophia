import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { ConversationStore } from '../../../src/main/storage/conversation-store'
import { isNotFoundError } from '../../../src/main/storage/fs-errors'
import { conversationsDir, conversationDir, conversationPath, conversationMessagesPath } from '../../../src/main/storage/app-data'


let dataRoot: string
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-convstore-'))
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  warnSpy.mockRestore()
  await rm(dataRoot, { recursive: true, force: true })
})

describe('isNotFoundError', () => {
  it('detects ENOENT and nothing else', () => {
    expect(isNotFoundError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(true)
    expect(isNotFoundError(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(false)
    expect(isNotFoundError(new SyntaxError('bad json'))).toBe(false)
    expect(isNotFoundError(null)).toBe(false)
  })
})

describe('ConversationStore read-path failure handling', () => {
  it('getMessages returns [] silently when the file simply does not exist', async () => {
    const store = new ConversationStore(dataRoot)
    const msgs = await store.getMessages('conv_missing')
    expect(msgs).toEqual([])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('getMessages keeps valid JSONL lines, skips malformed ones, and warns', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'c1', companionVersion: 1, textbookId: null, title: 't' })
    await store.addMessage(conv.id, 'user', 'hello')
    // Corrupt the file: append a broken line after the valid one
    await writeFile(
      conversationMessagesPath(dataRoot, conv.id),
      '{"id":"msg_1","conversationId":"x","role":"user","content":"ok","createdAt":"2024-01-01T00:00:00.000Z"}\n{broken json\n',
      'utf-8'
    )
    const msgs = await store.getMessages(conv.id)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('ok')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipped 1 malformed message line')
    )
  })

  it('getMessages warns and returns [] when the legacy JSON-array file is corrupt', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'c1', companionVersion: 1, textbookId: null, title: 't' })
    await writeFile(conversationMessagesPath(dataRoot, conv.id), '[{"role":', 'utf-8')
    const msgs = await store.getMessages(conv.id)
    expect(msgs).toEqual([])
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('get returns null silently for a missing conversation but warns on corruption', async () => {
    const store = new ConversationStore(dataRoot)
    expect(await store.get('conv_missing')).toBeNull()
    expect(warnSpy).not.toHaveBeenCalled()

    await mkdir(conversationDir(dataRoot, 'conv_broken'), { recursive: true })
    await writeFile(conversationPath(dataRoot, 'conv_broken'), '{corrupt', 'utf-8')
    expect(await store.get('conv_broken')).toBeNull()
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('list skips a corrupt conversation but keeps the healthy ones', async () => {
    const store = new ConversationStore(dataRoot)
    await store.create({ companionId: 'c1', companionVersion: 1, textbookId: null, title: 'healthy' })
    await mkdir(join(conversationsDir(dataRoot), 'conv_broken'), { recursive: true })
    await writeFile(conversationPath(dataRoot, 'conv_broken'), 'not json', 'utf-8')
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('healthy')
    expect(warnSpy).toHaveBeenCalledOnce()
  })
})

describe('ConversationStore truncateAfter', () => {
  it('keeps messages up to and including the target, drops the rest', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'c1', companionVersion: 1, textbookId: null, title: 't' })
    const m1 = await store.addMessage(conv.id, 'user', 'q1')
    const m2 = await store.addMessage(conv.id, 'assistant', 'a1')
    await store.addMessage(conv.id, 'user', 'q2')

    const ok = await store.truncateAfter(conv.id, m2.id)
    expect(ok).toBe(true)
    const msgs = await store.getMessages(conv.id)
    expect(msgs.map((m) => m.id)).toEqual([m1.id, m2.id])
  })

  it('returns false for a missing message or when nothing would change', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'c1', companionVersion: 1, textbookId: null, title: 't' })
    const m1 = await store.addMessage(conv.id, 'user', 'q1')
    expect(await store.truncateAfter(conv.id, 'missing')).toBe(false)
    expect(await store.truncateAfter(conv.id, m1.id)).toBe(false)
  })
})

describe('ConversationStore write path', () => {
  it('create → get round-trips with default fields', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: 'tb_1', title: '07-01 测试' })
    expect(conv.id).toBeTruthy()
    expect(conv.endedAt).toBeNull()
    const got = await store.get(conv.id)
    expect(got?.title).toBe('07-01 测试')
    expect(got?.textbookId).toBe('tb_1')
  })

  it('addMessage appends a message', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 't' })
    const msg = await store.addMessage(conv.id, 'user', '你好')
    expect(msg.role).toBe('user')
    expect(msg.content).toBe('你好')
    const msgs = await store.getMessages(conv.id)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(msg.id)
  })

  it('endConversation sets endedAt', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 't' })
    expect(await store.endConversation(conv.id)).toBe(true)
    expect((await store.get(conv.id))?.endedAt).toBeTruthy()
  })

  it('updateTitle / updateMessage / deleteMessage / delete', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: '旧标题' })
    const msg = await store.addMessage(conv.id, 'assistant', '旧内容')

    await store.updateTitle(conv.id, '新标题')
    expect((await store.get(conv.id))?.title).toBe('新标题')

    await store.updateMessage(conv.id, msg.id, '新内容')
    expect((await store.getMessages(conv.id))[0].content).toBe('新内容')

    expect(await store.deleteMessage(conv.id, msg.id)).toBe(true)
    expect(await store.getMessages(conv.id)).toHaveLength(0)

    expect(await store.delete(conv.id)).toBe(true)
    expect(await store.get(conv.id)).toBeNull()
  })

  it('list returns both conversations', async () => {
    const store = new ConversationStore(dataRoot)
    const a = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 'a' })
    const b = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 'b' })
    await store.addMessage(a.id, 'user', 'x')
    const list = await store.list()
    expect(list.map((c) => c.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('concurrent rewrite + appends must not lose messages (write queue)', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 't' })
    const seed = await store.addMessage(conv.id, 'user', 'seed')

    // A whole-file rewrite racing three JSONL appends. Without the per-
    // conversation write queue the rewrite is built from a stale snapshot
    // and silently drops the appends.
    await Promise.all([
      store.updateMessage(conv.id, seed.id, 'seed-edited'),
      store.addMessage(conv.id, 'assistant', 'a1'),
      store.addMessage(conv.id, 'user', 'a2'),
      store.addMessage(conv.id, 'assistant', 'a3')
    ])

    const all = await store.getMessages(conv.id)
    expect(all).toHaveLength(4)
    expect(all.map((m) => m.content)).toEqual(['seed-edited', 'a1', 'a2', 'a3'])
  })

  it('concurrent endConversation and addMessage both persist', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 't' })

    await Promise.all([
      store.endConversation(conv.id),
      store.addMessage(conv.id, 'assistant', 'final')
    ])

    const got = await store.get(conv.id)
    expect(got?.endedAt).toBeTruthy()
    expect(await store.getMessages(conv.id)).toHaveLength(1)
  })
})

describe('ConversationStore — missing targets and patchy files', () => {
  it('returns null/false for operations on a missing conversation', async () => {
    const store = new ConversationStore(dataRoot)

    await expect(store.endConversation('conv_missing')).resolves.toBe(false)
    await expect(store.updateTitle('conv_missing', 'x')).resolves.toBeNull()
    await expect(store.updateMessage('conv_missing', 'msg_x', 'x')).resolves.toBeNull()
    await expect(store.deleteMessage('conv_missing', 'msg_x')).resolves.toBe(false)
  })

  it('returns null/false for missing messages in an existing conversation', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 't' })

    await expect(store.updateMessage(conv.id, 'msg_missing', 'x')).resolves.toBeNull()
    await expect(store.deleteMessage(conv.id, 'msg_missing')).resolves.toBe(false)
  })

  it('skips blank lines in the JSONL message file', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 't' })
    const first = await store.addMessage(conv.id, 'user', '内容A')
    const second = await store.addMessage(conv.id, 'user', '内容B')

    // Blank lines between records must be skipped, not treated as corrupt.
    const path = conversationMessagesPath(dataRoot, conv.id)
    await writeFile(
      path,
      `${JSON.stringify(first)}\n\n   \n${JSON.stringify(second)}\n`
    )

    const messages = await store.getMessages(conv.id)
    expect(messages.map((m) => m.id)).toEqual([first.id, second.id])
  })

  it('ignores stale index hits whose message no longer matches', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 't' })
    const msg = await store.addMessage(conv.id, 'user', '关于熵')

    await store.searchMessages('熵') // builds and caches the index

    // Rewrite the file behind the store's back — the cached index is stale.
    await writeFile(
      conversationMessagesPath(dataRoot, conv.id),
      JSON.stringify({ ...msg, content: '改成了别的词' }) + '\n',
      'utf-8'
    )

    const result = await store.searchMessages('熵')

    expect(result.results).toHaveLength(0)
    expect(result.total).toBe(1) // the stale index still reports a hit
  })

  it('returns an empty list before any conversation exists', async () => {
    const store = new ConversationStore(dataRoot)
    await expect(store.list()).resolves.toEqual([])
  })

  it('keeps the search index warm across new messages', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 't' })
    await store.addMessage(conv.id, 'user', '第一句关于熵')

    const first = await store.searchMessages('熵')
    expect(first.results).toHaveLength(1)

    // The cached index is updated in place by addMessage.
    await store.addMessage(conv.id, 'assistant', '第二句也关于熵')
    const second = await store.searchMessages('熵')
    expect(second.results).toHaveLength(2)
    expect(second.total).toBe(2)
  })

  it('scans only indexed messages across conversations', async () => {
    const store = new ConversationStore(dataRoot)
    const first = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 'a' })
    const second = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 'b' })
    await store.addMessage(first.id, 'user', '关于熵的讨论')
    await store.addMessage(first.id, 'assistant', '无关内容')
    await store.addMessage(second.id, 'user', '另一条关于熵的')
    await store.addMessage(second.id, 'assistant', '也无关')

    const all = await store.searchMessages('熵', 50, 0)

    expect(all.total).toBe(2)
    expect(all.results).toHaveLength(2)
    expect(all.results.map((r) => r.message.content).sort()).toEqual(['关于熵的讨论', '另一条关于熵的'])

    // A limit smaller than the first conversation's hits stops the scan.
    const limited = await store.searchMessages('熵', 1, 0)
    expect(limited.results).toHaveLength(1)
  })

  it('paginates search results with limit and offset', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 't' })
    for (let i = 0; i < 5; i++) {
      await store.addMessage(conv.id, 'user', `关于熵的第 ${i} 条`)
    }

    const page = await store.searchMessages('熵', 2, 2)

    expect(page.results).toHaveLength(2)
    expect(page.total).toBe(5)
    expect(page.results.map((m) => m.message.content)).toEqual([
      '关于熵的第 2 条',
      '关于熵的第 3 条'
    ])
  })

  it('keeps working after a queued write fails', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 't' })
    // A directory where the message file belongs makes the append fail.
    await rm(conversationMessagesPath(dataRoot, conv.id), { recursive: true, force: true })
    await mkdir(conversationMessagesPath(dataRoot, conv.id), { recursive: true })

    await expect(store.addMessage(conv.id, 'user', 'x')).rejects.toThrow()

    // The queue tail swallowed the rejection — later writes still run.
    await rm(conversationMessagesPath(dataRoot, conv.id), { recursive: true, force: true })
    await expect(store.addMessage(conv.id, 'user', 'ok')).resolves.toMatchObject({ content: 'ok' })
  })

  it('appends a message even when the conversation record is missing', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 't' })
    await rm(conversationPath(dataRoot, conv.id), { force: true })

    const msg = await store.addMessage(conv.id, 'user', '孤儿消息')
    expect(msg.content).toBe('孤儿消息')
    expect(await store.getMessages(conv.id)).toHaveLength(1)
  })

  it('truncates messages even when the conversation record is missing', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', companionVersion: 1, textbookId: null, title: 't' })
    const first = await store.addMessage(conv.id, 'user', 'q1')
    await store.addMessage(conv.id, 'assistant', 'a1')
    await rm(conversationPath(dataRoot, conv.id), { force: true })

    expect(await store.truncateAfter(conv.id, first.id)).toBe(true)
    expect(await store.getMessages(conv.id)).toHaveLength(1)
  })
})
