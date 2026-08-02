import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  archiveItem,
  archiveCompanion,
  listArchive,
  restoreArchiveItem,
  purgeArchiveItem,
  archiveDir
} from '../../../src/main/storage/archive-store'

let dataRoot: string

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-archive-'))
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('archive-store', () => {
  it('moves a directory into the archive and lists it', async () => {
    const source = join(dataRoot, 'profiles', 'world_default', 'conversations', 'conv_1')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'conversation.json'), '{"id":"conv_1"}', 'utf-8')

    const entryId = await archiveItem(dataRoot, 'conversation', 'conv_1', source, '我的第一课')
    expect(entryId).toBeTruthy()

    // Original location is gone, archive holds it.
    await expect(access(source)).rejects.toThrow()
    await access(join(archiveDir(dataRoot), entryId!))

    const entries = await listArchive(dataRoot)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('conversation')
    expect(entries[0].label).toBe('我的第一课')
  })

  it('returns null when the source does not exist', async () => {
    const entryId = await archiveItem(dataRoot, 'conversation', 'nope', join(dataRoot, 'missing'), 'x')
    expect(entryId).toBeNull()
    expect(await listArchive(dataRoot)).toHaveLength(0)
  })

  it('restores an archived item to its original location', async () => {
    const source = join(dataRoot, 'textbooks', 'tb_2')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'textbook.json'), '{}', 'utf-8')

    const entryId = await archiveItem(dataRoot, 'textbook', 'tb_2', source, '教材')
    expect(await restoreArchiveItem(dataRoot, entryId!)).toBe(true)

    // Back in place, archive empty.
    await access(join(source, 'textbook.json'))
    expect(await listArchive(dataRoot)).toHaveLength(0)
  })

  it('purges an archived item permanently', async () => {
    const source = join(dataRoot, 'conversations', 'conv_3')
    await mkdir(source, { recursive: true })

    const entryId = await archiveItem(dataRoot, 'conversation', 'conv_3', source, 'x')
    expect(await purgeArchiveItem(dataRoot, entryId!)).toBe(true)
    await expect(access(join(archiveDir(dataRoot), entryId!))).rejects.toThrow()
    expect(await listArchive(dataRoot)).toHaveLength(0)
  })

  it('archives a companion snapshot and refuses directory restore', async () => {
    const entryId = await archiveCompanion(dataRoot, 'custom_9', '爱丽丝', { id: 'custom_9', name: '爱丽丝' })
    const entries = await listArchive(dataRoot)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('companion')

    // Companion restore is handled by the IPC layer (re-insert into index.json),
    // so the store-level restore correctly refuses.
    expect(await restoreArchiveItem(dataRoot, entryId)).toBe(false)

    // Snapshot file is readable.
    const snap = await readFile(join(archiveDir(dataRoot), entryId, 'companion.json'), 'utf-8')
    expect(JSON.parse(snap).name).toBe('爱丽丝')
  })

  it('restore/purge of an unknown entry returns false', async () => {
    expect(await restoreArchiveItem(dataRoot, 'does-not-exist')).toBe(false)
    expect(await purgeArchiveItem(dataRoot, 'does-not-exist')).toBe(false)
  })
})
