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
  isSafeOriginalPath,
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
    const entryId = await archiveCompanion(dataRoot, 'custom_9', '朗道', { id: 'custom_9', name: '朗道' })
    const entries = await listArchive(dataRoot)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('companion')

    // Companion restore is handled by the IPC layer (re-insert into index.json),
    // so the store-level restore correctly refuses.
    expect(await restoreArchiveItem(dataRoot, entryId)).toBe(false)

    // Snapshot file is readable.
    const snap = await readFile(join(archiveDir(dataRoot), entryId, 'companion.json'), 'utf-8')
    expect(JSON.parse(snap).name).toBe('朗道')
  })

  it('restore/purge of an unknown entry returns false', async () => {
    expect(await restoreArchiveItem(dataRoot, 'does-not-exist')).toBe(false)
    expect(await purgeArchiveItem(dataRoot, 'does-not-exist')).toBe(false)
  })

  // --- Tampered manifest defense (the manifest is a synced file) ---

  it('restore refuses a manifest entry that escapes dataRoot', async () => {
    const archiveEntry = join(archiveDir(dataRoot), 'evil_entry')
    await mkdir(archiveEntry, { recursive: true })
    await writeFile(join(archiveEntry, 'loot.txt'), 'stolen', 'utf-8')
    await writeFile(
      join(archiveDir(dataRoot), 'manifest.json'),
      JSON.stringify({
        evil_entry: {
          id: 'evil_entry',
          kind: 'textbook',
          label: 'evil',
          movedAt: new Date().toISOString(),
          originalPath: '../../escape-here'
        }
      }),
      'utf-8'
    )

    expect(await restoreArchiveItem(dataRoot, 'evil_entry')).toBe(false)
    // The archived content must still be in the archive, not moved outside.
    await access(join(archiveEntry, 'loot.txt'))
  })

  it('restore refuses absolute and empty original paths', async () => {
    await mkdir(archiveDir(dataRoot), { recursive: true })
    await writeFile(
      join(archiveDir(dataRoot), 'manifest.json'),
      JSON.stringify({
        abs_entry: {
          id: 'abs_entry',
          kind: 'textbook',
          label: 'abs',
          movedAt: new Date().toISOString(),
          originalPath: 'C:\\Windows'
        }
      }),
      'utf-8'
    )
    expect(await restoreArchiveItem(dataRoot, 'abs_entry')).toBe(false)
  })

  it('purge refuses unsafe entry ids instead of deleting outside the archive', async () => {
    const victim = join(dataRoot, 'victim')
    await mkdir(victim, { recursive: true })
    await writeFile(join(victim, 'keep.txt'), 'keep', 'utf-8')

    expect(await purgeArchiveItem(dataRoot, '..\\victim')).toBe(false)
    expect(await purgeArchiveItem(dataRoot, '../victim')).toBe(false)
    await access(join(victim, 'keep.txt'))
  })

  it('uses the manifest key, not a tampered entry.id, as the archive path', async () => {
    const entryId = 'safe_entry'
    const archiveEntry = join(archiveDir(dataRoot), entryId)
    await mkdir(archiveEntry, { recursive: true })
    await writeFile(
      join(archiveDir(dataRoot), 'manifest.json'),
      JSON.stringify({
        [entryId]: {
          id: '../../outside',
          kind: 'textbook',
          label: 'tampered',
          movedAt: new Date().toISOString(),
          originalPath: 'textbooks/tb_9'
        }
      }),
      'utf-8'
    )

    expect(await purgeArchiveItem(dataRoot, entryId)).toBe(true)
    await expect(access(archiveEntry)).rejects.toThrow()
  })

  it('list drops malformed manifest entries without crashing', async () => {
    await mkdir(archiveDir(dataRoot), { recursive: true })
    await writeFile(
      join(archiveDir(dataRoot), 'manifest.json'),
      JSON.stringify({
        ok_entry: {
          id: 'ok_entry',
          kind: 'textbook',
          label: 'ok',
          movedAt: new Date().toISOString(),
          originalPath: 'textbooks/tb_1'
        },
        broken: { kind: 'textbook' },
        '../escape': {
          id: '../escape',
          kind: 'textbook',
          label: 'x',
          movedAt: new Date().toISOString(),
          originalPath: 'textbooks/tb_2'
        }
      }),
      'utf-8'
    )

    const entries = await listArchive(dataRoot)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('ok_entry')
  })

  it('drops manifests that are not plain objects and entries with junk values', async () => {
    await mkdir(archiveDir(dataRoot), { recursive: true })
    const manifestPath = join(archiveDir(dataRoot), 'manifest.json')

    // An array (or scalar) instead of an object → empty manifest.
    await writeFile(manifestPath, '[]', 'utf-8')
    await expect(listArchive(dataRoot)).resolves.toEqual([])

    // Entries rejected field by field.
    await writeFile(
      manifestPath,
      JSON.stringify({
        array_value: [{ kind: 'textbook', label: 'x', movedAt: 't' }],
        no_kind: { label: 'x', movedAt: 't' },
        no_label: { kind: 'textbook', movedAt: 't' },
        no_moved_at: { kind: 'textbook', label: 'x' }
      }),
      'utf-8'
    )

    await expect(listArchive(dataRoot)).resolves.toEqual([])
  })

  it('defaults a missing originalPath to an empty string', async () => {
    await mkdir(archiveDir(dataRoot), { recursive: true })
    await writeFile(
      join(archiveDir(dataRoot), 'manifest.json'),
      JSON.stringify({
        no_path: {
          id: 'no_path',
          kind: 'textbook',
          label: 'x',
          movedAt: new Date().toISOString()
        }
      }),
      'utf-8'
    )

    const entries = await listArchive(dataRoot)
    expect(entries).toHaveLength(1)
    expect(entries[0].originalPath).toBe('')
  })

  it('refuses unsafe ids and companion entries on restore', async () => {
    await mkdir(archiveDir(dataRoot), { recursive: true })

    await expect(restoreArchiveItem(dataRoot, '../escape')).resolves.toBe(false)

    // A companion entry can only be restored through the archive IPC.
    const entryId = 'companion_entry'
    await writeFile(
      join(archiveDir(dataRoot), 'manifest.json'),
      JSON.stringify({
        [entryId]: {
          id: entryId,
          kind: 'companion',
          label: '朗道',
          movedAt: new Date().toISOString(),
          originalPath: ''
        }
      }),
      'utf-8'
    )
    await expect(restoreArchiveItem(dataRoot, entryId)).resolves.toBe(false)
  })

  it('rejects unsafe candidate paths and empty ids', async () => {
    // Empty / non-string / absolute / escaping paths are all refused.
    expect(isSafeOriginalPath(dataRoot, '')).toBe(false)
    expect(isSafeOriginalPath(dataRoot, 42)).toBe(false)
    expect(isSafeOriginalPath(dataRoot, '../outside')).toBe(false)
    expect(isSafeOriginalPath(dataRoot, 'profiles/ok.json')).toBe(true)

    await expect(purgeArchiveItem(dataRoot, '')).resolves.toBe(false)
  })
})
