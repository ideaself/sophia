import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadSyncState, saveSyncState, type SyncState } from '../../../src/main/sync/sync-state'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sophia-state-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('sync-state', () => {
  it('returns null when no state file exists', async () => {
    expect(await loadSyncState(dir)).toBeNull()
  })

  it('round-trips state through save and load', async () => {
    const state: SyncState = {
      version: 1,
      files: {
        'profiles/p/story.md': {
          localSize: 10,
          localMtimeMs: 1720000000000,
          remoteSize: 10,
          remoteLastmod: 'Tue, 01 Jan 2030 00:00:00 GMT'
        },
        'seeded/remote-only.bin': {
          localSize: null,
          localMtimeMs: null,
          remoteSize: 99,
          remoteLastmod: 'Wed, 02 Jan 2030 00:00:00 GMT'
        }
      }
    }
    await saveSyncState(dir, state)
    expect(await loadSyncState(dir)).toEqual(state)
  })

  it('returns null for a corrupted state file instead of throwing', async () => {
    await saveSyncState(dir, { version: 1, files: {} })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'sync-state.json'), '{not json', 'utf-8')
    expect(await loadSyncState(dir)).toBeNull()
  })
})
