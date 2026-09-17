/**
 * companions.ts IPC — index-backed CRUD, version bumping on edit, archival +
 * candidate tombstones on delete.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
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

import { registerCompanionIpc } from '../../../src/main/ipc/companions'
import { loadReferenceCompanions } from '../../../src/main/companions/reference-loader'
import { companionDir } from '../../../src/main/storage/app-data'

const projectsRoot = join(__dirname, '..', '..', '..')
const candidatesDir = join(projectsRoot, 'reference', '角色设定', 'candidates')

let dataRoot = ''

async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return (await handler({}, input)) as T
}

const CUSTOM_INPUT = {
  name: '自建导师',
  gender: 'female',
  age: 30,
  identity: '物理讲师',
  personalityKeywords: ['耐心', '严谨'],
  personality: '她会把难题拆成小步。',
  speakingStyle: '语速平缓，常用类比。',
  emotionalExpressions: '开心时会多讲一个例子。'
}

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-companions-'))
  mocks.handlers.clear()
  registerCompanionIpc(dataRoot)
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('companions IPC — CRUD', () => {
  it('starts empty and creates a custom companion', async () => {
    await expect(invoke('companion:list')).resolves.toEqual([])
    await expect(invoke('companion:get', { companionId: 'nope' })).resolves.toBeNull()

    const created = await invoke<{ id: string; version: number; source: string; name: string }>(
      'companion:create',
      CUSTOM_INPUT
    )
    expect(created.id).toMatch(/^custom_\d+$/)
    expect(created).toMatchObject({ version: 1, source: 'custom', name: '自建导师' })

    await expect(invoke('companion:get', { companionId: created.id })).resolves.toMatchObject({
      id: created.id
    })
    await expect(invoke<unknown[]>('companion:list')).resolves.toHaveLength(1)

    // Persisted to the index file.
    const raw = JSON.parse(
      await readFile(join(companionDir(dataRoot), 'index.json'), 'utf-8')
    ) as Array<{ id: string }>
    expect(raw.map((c) => c.id)).toContain(created.id)
  })

  it('validates input on the IPC boundary', async () => {
    await expect(
      invoke('companion:create', { ...CUSTOM_INPUT, gender: '外星人' })
    ).rejects.toThrow()
    await expect(invoke('companion:create', { ...CUSTOM_INPUT, age: 'old' })).rejects.toThrow()
  })

  it('bumps the version on every edit and keeps the id', async () => {
    const created = await invoke<{ id: string }>('companion:create', CUSTOM_INPUT)

    const updated = await invoke<{ version: number; name: string }>('companion:update', {
      companionId: created.id,
      name: '改名导师'
    })
    expect(updated).toMatchObject({ version: 2, name: '改名导师' })

    const again = await invoke<{ version: number }>('companion:update', {
      companionId: created.id,
      identity: '数学讲师'
    })
    expect(again.version).toBe(3)

    await expect(
      invoke('companion:update', { companionId: 'missing', name: 'x' })
    ).resolves.toBeNull()
  })

  it('rejects invalid updates', async () => {
    const created = await invoke<{ id: string }>('companion:create', CUSTOM_INPUT)
    await expect(
      invoke('companion:update', { companionId: created.id, personalityKeywords: 'not-an-array' })
    ).rejects.toThrow()
  })

  it('archives and tombstones candidate companions on delete', async () => {
    await loadReferenceCompanions({ candidatesDir, companionDir: companionDir(dataRoot) })
    const list = await invoke<Array<{ id: string; source: string }>>('companion:list')
    const candidate = list.find((c) => c.source === 'candidate')!
    expect(candidate).toBeDefined()

    await expect(invoke('companion:delete', { companionId: candidate.id })).resolves.toBe(true)
    await expect(invoke('companion:get', { companionId: candidate.id })).resolves.toBeNull()

    // The tombstone keeps the deletion stable across restarts.
    const tombstones = JSON.parse(
      await readFile(join(companionDir(dataRoot), '.deleted-candidates.json'), 'utf-8')
    ) as string[]
    expect(tombstones).toContain(candidate.id)
  })

  it('deletes custom companions without a tombstone and reports misses', async () => {
    const created = await invoke<{ id: string }>('companion:create', CUSTOM_INPUT)

    await expect(invoke('companion:delete', { companionId: created.id })).resolves.toBe(true)
    await expect(invoke<unknown[]>('companion:list')).resolves.toEqual([])
    await expect(invoke('companion:delete', { companionId: created.id })).resolves.toBe(false)

    await expect(
      readFile(join(companionDir(dataRoot), '.deleted-candidates.json'), 'utf-8')
    ).rejects.toThrow()
  })

  it('returns an empty list for a corrupted index', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(companionDir(dataRoot), { recursive: true })
    await writeFile(join(companionDir(dataRoot), 'index.json'), '{ broken', 'utf-8')

    await expect(invoke('companion:list')).resolves.toEqual([])
  })
})
