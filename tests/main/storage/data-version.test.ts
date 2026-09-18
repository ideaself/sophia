import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DATA_VERSION,
  DATA_VERSION_FILE,
  migrateDataRoot,
  readDataVersion,
  type DataMigration
} from '../../../src/main/storage/data-version'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sophia-data-version-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function stampedVersion(): Promise<number> {
  return readDataVersion(dir)
}

describe('readDataVersion', () => {
  it('returns 0 when the marker does not exist (pre-versioning data root)', async () => {
    expect(await readDataVersion(dir)).toBe(0)
  })

  it('returns the stamped version', async () => {
    await writeFile(join(dir, DATA_VERSION_FILE), JSON.stringify({ version: 7 }), 'utf-8')
    expect(await readDataVersion(dir)).toBe(7)
  })

  it('falls back to 0 and warns on unrecognizable content', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await writeFile(join(dir, DATA_VERSION_FILE), 'not json', 'utf-8')

    expect(await readDataVersion(dir)).toBe(0)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to read ${DATA_VERSION_FILE}`),
      expect.anything()
    )
  })

  it('falls back to 0 on a marker without a numeric version', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await writeFile(join(dir, DATA_VERSION_FILE), JSON.stringify({ version: 'new' }), 'utf-8')
    expect(await readDataVersion(dir)).toBe(0)
  })

  it('warns on a non-ENOENT read failure (unreadable marker)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // A directory at the marker path makes readFile fail with EISDIR.
    await mkdir(join(dir, DATA_VERSION_FILE), { recursive: true })

    expect(await readDataVersion(dir)).toBe(0)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to read ${DATA_VERSION_FILE}`),
      expect.anything()
    )
  })
})

describe('migrateDataRoot', () => {
  it('stamps a fresh data root with the current version (no migration reported)', async () => {
    const state = await migrateDataRoot(dir)

    expect(state).toEqual({ version: DATA_VERSION, migratedFrom: null, downgraded: false })
    expect(await stampedVersion()).toBe(DATA_VERSION)
  })

  it('records the timestamp next to the version', async () => {
    await migrateDataRoot(dir)
    const raw = JSON.parse(await readFile(join(dir, DATA_VERSION_FILE), 'utf-8')) as {
      updatedAt?: string
    }
    expect(Number.isNaN(Date.parse(raw.updatedAt ?? ''))).toBe(false)
  })

  it('upgrades a pre-versioning data root (version 0) and reports the origin', async () => {
    await writeFile(join(dir, DATA_VERSION_FILE), JSON.stringify({ version: 0 }), 'utf-8')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const upgraded = await migrateDataRoot(dir)

    expect(upgraded).toEqual({ version: DATA_VERSION, migratedFrom: 0, downgraded: false })
    expect(await readDataVersion(dir)).toBe(DATA_VERSION)
    expect(log).toHaveBeenCalledWith(`[data] migrated LocalData v0 -> v${DATA_VERSION}`)
  })

  it('does not rewrite a data root that is already current', async () => {
    await migrateDataRoot(dir)
    const before = await readFile(join(dir, DATA_VERSION_FILE), 'utf-8')

    const state = await migrateDataRoot(dir)
    expect(state).toEqual({ version: DATA_VERSION, migratedFrom: null, downgraded: false })
    expect(await readFile(join(dir, DATA_VERSION_FILE), 'utf-8')).toBe(before)
  })

  it('leaves data from a newer app untouched and reports the downgrade', async () => {
    const newer = { version: DATA_VERSION + 1, updatedAt: '2030-01-01T00:00:00.000Z' }
    const raw = JSON.stringify(newer)
    await writeFile(join(dir, DATA_VERSION_FILE), raw, 'utf-8')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const state = await migrateDataRoot(dir)

    expect(state).toEqual({ version: DATA_VERSION + 1, migratedFrom: null, downgraded: true })
    expect(await readFile(join(dir, DATA_VERSION_FILE), 'utf-8')).toBe(raw)
    expect(warn).toHaveBeenCalledWith(
      `[data] LocalData is version ${DATA_VERSION + 1}, newer than this app (${DATA_VERSION}); leaving it untouched`
    )
  })

  it('treats a corrupt marker as version 0 and re-stamps it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await writeFile(join(dir, DATA_VERSION_FILE), '{oops', 'utf-8')

    const state = await migrateDataRoot(dir)
    expect(state).toEqual({ version: DATA_VERSION, migratedFrom: 0, downgraded: false })
    expect(await stampedVersion()).toBe(DATA_VERSION)
  })

  it('runs registered migrations in order and stops at the target version', async () => {
    const order: number[] = []
    const migrations: Record<number, DataMigration> = {
      0: async () => {
        order.push(0)
      },
      1: async () => {
        order.push(1)
      },
      2: async () => {
        order.push(2)
      }
    }

    const state = await migrateDataRoot(dir, { migrations, targetVersion: 2 })
    expect(order).toEqual([0, 1])
    expect(state).toEqual({ version: 2, migratedFrom: null, downgraded: false })
  })

  it('continues from the stamped version on the next run', async () => {
    const order: number[] = []
    const migrations: Record<number, DataMigration> = {
      0: async () => {
        order.push(0)
      },
      1: async () => {
        order.push(1)
      }
    }

    await migrateDataRoot(dir, { migrations, targetVersion: 2 })
    await migrateDataRoot(dir, { migrations, targetVersion: 2 })
    expect(order).toEqual([0, 1])
  })

  it('does not stamp the version when a migration fails, so it can be retried', async () => {
    const migrations: Record<number, DataMigration> = {
      0: async () => {
        throw new Error('disk full')
      }
    }

    await expect(
      migrateDataRoot(dir, { migrations, targetVersion: DATA_VERSION })
    ).rejects.toThrow('disk full')
    expect(await readDataVersion(dir)).toBe(0)
  })
})
