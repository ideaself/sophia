import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { maybeAutoBackup } from '../../../src/main/backup/auto-backup'

const TEST_ID = `auto-backup-${randomUUID()}`
const tempBase = join(tmpdir(), TEST_ID)

let dataRoot: string
let backupRoot: string

beforeEach(async () => {
  dataRoot = join(tempBase, 'data')
  backupRoot = join(tempBase, 'SophiaLocal-backups')
  await mkdir(dataRoot, { recursive: true })
  await writeFile(join(dataRoot, 'hello.txt'), 'hello')
})

afterEach(async () => {
  await rm(tempBase, { recursive: true, force: true })
})

async function listAutoBackups(): Promise<string[]> {
  try {
    return (await readdir(backupRoot))
      .filter((f) => f.startsWith('auto-') && f.endsWith('.zip'))
      .sort()
  } catch {
    return []
  }
}

async function writeOldBackup(name: string, ageDays: number): Promise<void> {
  await mkdir(backupRoot, { recursive: true })
  const p = join(backupRoot, name)
  await writeFile(p, 'fake')
  const t = new Date(Date.now() - ageDays * 24 * 3600 * 1000)
  await utimes(p, t, t)
}

describe('maybeAutoBackup', () => {
  it('creates a backup when the newest auto backup is older than 7 days', async () => {
    await writeOldBackup('auto-2020-01-01.zip', 30)
    await maybeAutoBackup(dataRoot)
    const files = await listAutoBackups()
    expect(files.length).toBe(2)
    expect(files.some((f) => f !== 'auto-2020-01-01.zip')).toBe(true)
  })

  it('skips when a backup exists within the interval', async () => {
    await writeOldBackup('auto-fresh.zip', 1)
    await maybeAutoBackup(dataRoot)
    expect(await listAutoBackups()).toEqual(['auto-fresh.zip'])
  })

  it('prunes old backups, keeping 5 total', async () => {
    for (let i = 1; i <= 8; i++) {
      await writeOldBackup(`auto-old-${i}.zip`, 30 + i)
    }
    await maybeAutoBackup(dataRoot)
    const files = await listAutoBackups()
    expect(files.length).toBe(5)
    // Keeps the newest 4 old backups plus the new one
    expect(files).toContain('auto-old-1.zip')
    expect(files).toContain('auto-old-2.zip')
    expect(files).toContain('auto-old-3.zip')
    expect(files).toContain('auto-old-4.zip')
    expect(files).not.toContain('auto-old-5.zip')
    expect(files.some((f) => /^auto-\d{4}-\d{2}-\d{2}\.zip$/.test(f))).toBe(true)
  })

  it('leaves non-auto files untouched', async () => {
    await mkdir(backupRoot, { recursive: true })
    await writeFile(join(backupRoot, 'manual.zip'), 'x')
    await maybeAutoBackup(dataRoot)
    const files = await readdir(backupRoot)
    expect(files).toContain('manual.zip')
    expect(files.some((f) => f.startsWith('auto-'))).toBe(true)
  })
})
