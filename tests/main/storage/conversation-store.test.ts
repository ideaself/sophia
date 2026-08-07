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
    const conv = await store.create({ companionId: 'c1', textbookId: null, title: 't' })
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
    const conv = await store.create({ companionId: 'c1', textbookId: null, title: 't' })
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
    await store.create({ companionId: 'c1', textbookId: null, title: 'healthy' })
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
    const conv = await store.create({ companionId: 'c1', textbookId: null, title: 't' })
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
    const conv = await store.create({ companionId: 'c1', textbookId: null, title: 't' })
    const m1 = await store.addMessage(conv.id, 'user', 'q1')
    expect(await store.truncateAfter(conv.id, 'missing')).toBe(false)
    expect(await store.truncateAfter(conv.id, m1.id)).toBe(false)
  })
})

describe('ConversationStore write path', () => {
  it('create → get round-trips with default fields', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', textbookId: 'tb_1', title: '07-01 测试' })
    expect(conv.id).toBeTruthy()
    expect(conv.endedAt).toBeNull()
    const got = await store.get(conv.id)
    expect(got?.title).toBe('07-01 测试')
    expect(got?.textbookId).toBe('tb_1')
  })

  it('addMessage appends a message', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', textbookId: null, title: 't' })
    const msg = await store.addMessage(conv.id, 'user', '你好')
    expect(msg.role).toBe('user')
    expect(msg.content).toBe('你好')
    const msgs = await store.getMessages(conv.id)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(msg.id)
  })

  it('endConversation sets endedAt', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', textbookId: null, title: 't' })
    expect(await store.endConversation(conv.id)).toBe(true)
    expect((await store.get(conv.id))?.endedAt).toBeTruthy()
  })

  it('updateTitle / updateMessage / deleteMessage / delete', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ companionId: 'comp_a', textbookId: null, title: '旧标题' })
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
    const a = await store.create({ companionId: 'comp_a', textbookId: null, title: 'a' })
    const b = await store.create({ companionId: 'comp_a', textbookId: null, title: 'b' })
    await store.addMessage(a.id, 'user', 'x')
    const list = await store.list()
    expect(list.map((c) => c.id).sort()).toEqual([a.id, b.id].sort())
  })
})
