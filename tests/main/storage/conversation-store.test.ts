import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { ConversationStore } from '../../../src/main/storage/conversation-store'
import { isNotFoundError } from '../../../src/main/storage/fs-errors'
import { conversationsDir, conversationDir, conversationPath, conversationMessagesPath } from '../../../src/main/storage/app-data'
import type { WorldId } from '../../../src/shared/types/ids'

const WORLD_ID = 'world_default' as WorldId

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
    const msgs = await store.getMessages('conv_missing', WORLD_ID)
    expect(msgs).toEqual([])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('getMessages keeps valid JSONL lines, skips malformed ones, and warns', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ worldId: WORLD_ID, companionId: 'c1', textbookId: null, title: 't' })
    await store.addMessage(conv.id, WORLD_ID, 'user', 'hello')
    // Corrupt the file: append a broken line after the valid one
    await writeFile(
      conversationMessagesPath(dataRoot, conv.id, WORLD_ID),
      '{"id":"msg_1","conversationId":"x","role":"user","content":"ok","createdAt":"2024-01-01T00:00:00.000Z"}\n{broken json\n',
      'utf-8'
    )
    const msgs = await store.getMessages(conv.id, WORLD_ID)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('ok')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipped 1 malformed message line')
    )
  })

  it('getMessages warns and returns [] when the legacy JSON-array file is corrupt', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ worldId: WORLD_ID, companionId: 'c1', textbookId: null, title: 't' })
    await writeFile(conversationMessagesPath(dataRoot, conv.id, WORLD_ID), '[{"role":', 'utf-8')
    const msgs = await store.getMessages(conv.id, WORLD_ID)
    expect(msgs).toEqual([])
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('get returns null silently for a missing conversation but warns on corruption', async () => {
    const store = new ConversationStore(dataRoot)
    expect(await store.get('conv_missing', WORLD_ID)).toBeNull()
    expect(warnSpy).not.toHaveBeenCalled()

    await mkdir(conversationDir(dataRoot, 'conv_broken', WORLD_ID), { recursive: true })
    await writeFile(conversationPath(dataRoot, 'conv_broken', WORLD_ID), '{corrupt', 'utf-8')
    expect(await store.get('conv_broken', WORLD_ID)).toBeNull()
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('list skips a corrupt conversation but keeps the healthy ones', async () => {
    const store = new ConversationStore(dataRoot)
    await store.create({ worldId: WORLD_ID, companionId: 'c1', textbookId: null, title: 'healthy' })
    await mkdir(join(conversationsDir(dataRoot, WORLD_ID), 'conv_broken'), { recursive: true })
    await writeFile(conversationPath(dataRoot, 'conv_broken', WORLD_ID), 'not json', 'utf-8')
    const all = await store.list(WORLD_ID)
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('healthy')
    expect(warnSpy).toHaveBeenCalledOnce()
  })
})

describe('ConversationStore truncateAfter', () => {
  it('keeps messages up to and including the target, drops the rest', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ worldId: WORLD_ID, companionId: 'c1', textbookId: null, title: 't' })
    const m1 = await store.addMessage(conv.id, WORLD_ID, 'user', 'q1')
    const m2 = await store.addMessage(conv.id, WORLD_ID, 'assistant', 'a1')
    await store.addMessage(conv.id, WORLD_ID, 'user', 'q2')

    const ok = await store.truncateAfter(conv.id, WORLD_ID, m2.id)
    expect(ok).toBe(true)
    const msgs = await store.getMessages(conv.id, WORLD_ID)
    expect(msgs.map((m) => m.id)).toEqual([m1.id, m2.id])
  })

  it('returns false for a missing message or when nothing would change', async () => {
    const store = new ConversationStore(dataRoot)
    const conv = await store.create({ worldId: WORLD_ID, companionId: 'c1', textbookId: null, title: 't' })
    const m1 = await store.addMessage(conv.id, WORLD_ID, 'user', 'q1')
    expect(await store.truncateAfter(conv.id, WORLD_ID, 'missing')).toBe(false)
    expect(await store.truncateAfter(conv.id, WORLD_ID, m1.id)).toBe(false)
  })
})
