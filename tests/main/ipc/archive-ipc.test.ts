/**
 * archive.ts IPC — listing, restoring (conversations and companions) and
 * purging archived items, including the candidate tombstone cleanup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

type Handler = (event: unknown, input?: unknown) => Promise<unknown>

const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      mocks.handlers.set(channel, fn)
    }
  }
}))

import { registerArchiveIpc } from '../../../src/main/ipc/archive'
import {
  archiveCompanion,
  archiveItem,
  listArchive
} from '../../../src/main/storage/archive-store'
import { companionDir, conversationDir } from '../../../src/main/storage/app-data'

let dataRoot = ''

async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return (await handler({}, input)) as T
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const COMPANION = {
  id: 'comp_landau',
  source: 'candidate',
  version: 3,
  name: '朗道',
  gender: 'male',
  age: 40,
  identity: '理论物理学家',
  personalityKeywords: ['严密'],
  personality: 'p',
  speakingStyle: 's',
  emotionalExpressions: 'e',
  originalFile: 'landau.md'
}

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-archive-'))
  mocks.handlers.clear()
  registerArchiveIpc(dataRoot)
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('archive IPC — list and purge', () => {
  it('lists archived items and purges them', async () => {
    const conv = conversationDir(dataRoot, 'conv_1')
    await mkdir(conv, { recursive: true })
    await writeFile(join(conv, 'messages.jsonl'), '{}\n', 'utf-8')
    const entryId = await archiveItem(dataRoot, 'conversation', 'conv_1', conv, '第一节')
    expect(entryId).toBeTruthy()

    const entries = await invoke<Array<{ id: string; kind: string; label: string }>>('archive:list')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'conversation', label: '第一节' })

    await expect(invoke('archive:purge', { entryId })).resolves.toEqual({ success: true })
    await expect(invoke('archive:purge', { entryId: 'missing_entry' })).resolves.toEqual({
      success: false
    })
    await expect(invoke('archive:purge', { entryId: '../escape' })).rejects.toThrow()
    await expect(invoke<unknown[]>('archive:list')).resolves.toEqual([])
  })
})

describe('archive IPC — conversation restore', () => {
  it('moves a conversation back and drops the archive entry', async () => {
    const conv = conversationDir(dataRoot, 'conv_2')
    await mkdir(conv, { recursive: true })
    await writeFile(join(conv, 'messages.jsonl'), '{"id":"m1"}\n', 'utf-8')
    const entryId = (await archiveItem(dataRoot, 'conversation', 'conv_2', conv, '第二节'))!

    await expect(invoke('archive:restore', { entryId })).resolves.toEqual({ success: true })

    expect(await exists(join(conv, 'messages.jsonl'))).toBe(true)
    await expect(invoke<unknown[]>('archive:list')).resolves.toEqual([])
  })

  it('reports unknown entries and invalid ids', async () => {
    await expect(invoke('archive:restore', { entryId: 'nope' })).resolves.toEqual({
      success: false
    })
    await expect(invoke('archive:restore', { entryId: '' })).rejects.toThrow()
  })
})

describe('archive IPC — companion restore', () => {
  it('re-inserts the companion, clears the tombstone and removes the archive', async () => {
    const entryId = await archiveCompanion(dataRoot, COMPANION.id, COMPANION.name, COMPANION)
    // Simulate a prior deletion tombstone.
    await mkdir(companionDir(dataRoot), { recursive: true })
    await writeFile(
      join(companionDir(dataRoot), '.deleted-candidates.json'),
      JSON.stringify(['comp_landau']),
      'utf-8'
    )

    await expect(invoke('archive:restore', { entryId })).resolves.toEqual({ success: true })

    const index = JSON.parse(
      await readFile(join(companionDir(dataRoot), 'index.json'), 'utf-8')
    ) as Array<{ id: string }>
    expect(index.map((c) => c.id)).toContain('comp_landau')

    const tombstones = JSON.parse(
      await readFile(join(companionDir(dataRoot), '.deleted-candidates.json'), 'utf-8')
    ) as string[]
    expect(tombstones).not.toContain('comp_landau')
    expect(await listArchive(dataRoot)).toEqual([])
  })

  it('refuses when the id is taken or the snapshot is gone', async () => {
    // The id already exists in the index.
    const first = await archiveCompanion(dataRoot, COMPANION.id, COMPANION.name, COMPANION)
    await mkdir(companionDir(dataRoot), { recursive: true })
    await writeFile(
      join(companionDir(dataRoot), 'index.json'),
      JSON.stringify([{ id: 'comp_landau' }]),
      'utf-8'
    )
    await expect(invoke('archive:restore', { entryId: first })).resolves.toEqual({
      success: false
    })

    // Missing snapshot file.
    const second = await archiveCompanion(dataRoot, 'comp_new', '新角色', {
      ...COMPANION,
      id: 'comp_new'
    })
    await rm(join(dataRoot, 'archive', second, 'companion.json'), { force: true })
    await expect(invoke('archive:restore', { entryId: second })).resolves.toEqual({
      success: false
    })

    // A corrupt index (not an array) is tolerated → restore re-creates it.
    await writeFile(join(companionDir(dataRoot), 'index.json'), '{"broken":true}', 'utf-8')
    await expect(invoke('archive:restore', { entryId: first })).resolves.toEqual({
      success: true
    })
    const repaired = JSON.parse(
      await readFile(join(companionDir(dataRoot), 'index.json'), 'utf-8')
    ) as Array<{ id: string }>
    expect(repaired.map((c) => c.id)).toEqual(['comp_landau'])
  })
})
