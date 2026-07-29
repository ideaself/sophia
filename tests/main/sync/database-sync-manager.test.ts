import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { DatabaseSyncManager, DatabaseSyncFailureType } from '../../../src/main/sync/database-sync-manager'
import type { WebDavConfig } from '../../../src/main/sync/webdav-client'

const CONFIG: WebDavConfig = { url: 'https://example.com/dav', username: 'u', password: 'p' }

/**
 * Probe once whether the system `sqlite3` CLI is installed. The production
 * code uses it for deep integrity checks and VACUUM INTO snapshots. When the
 * CLI is present, `validateDatabase` runs a real PRAGMA integrity_check, so
 * tests that need to "pass validation" must feed it a *real* SQLite database
 * — a hand-crafted 100-byte header is no longer enough.
 */
let hasSqliteCli = false
beforeAll(() => {
  try {
    execFileSync('sqlite3', ['-version'], { stdio: 'ignore', timeout: 5000 })
    hasSqliteCli = true
  } catch {
    hasSqliteCli = false
  }
})

/** In-memory stand-in for SyncWebDavClient — records calls, serves canned data. */
class FakeClient {
  private remote = new Map<string, { content: Buffer; lastmod: string }>()
  private clock = 0
  uploads: { path: string; content: Buffer }[] = []
  downloads: string[] = []
  deletions: string[] = []

  /** Test helper: place a file on the fake server. */
  setRemote(path: string, content: string | Buffer, lastmod?: string): void {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
    this.remote.set(path, { content: buf, lastmod: lastmod ?? `mod-${++this.clock}` })
  }

  async uploadFile(path: string, content: string | Buffer): Promise<void> {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
    this.uploads.push({ path, content: buf })
    this.setRemote(path, buf)
  }

  async downloadToFile(path: string, localPath: string): Promise<void> {
    const f = this.remote.get(path)
    if (!f) throw new Error(`no such remote file: ${path}`)
    this.downloads.push(path)
    await writeFile(localPath, f.content)
  }

  async downloadFile(path: string): Promise<string> {
    const f = this.remote.get(path)
    if (!f) throw new Error(`no such remote file: ${path}`)
    this.downloads.push(path)
    return f.content.toString('utf-8')
  }

  async deleteFile(path: string): Promise<void> {
    this.remote.delete(path)
    this.deletions.push(path)
  }

  async ensureDir(_dir: string): Promise<void> {}

  async listFiles(_dir: string): Promise<{ path: string; isDir: boolean }[]> {
    return []
  }

  async listAllFilesDetailed(_dir: string): Promise<{ path: string; size: number; lastmod: string }[]> {
    return []
  }
}

function makeManager(dataRoot: string): DatabaseSyncManager {
  return new DatabaseSyncManager(dataRoot)
}

let dataRoot: string
let parentDir: string

beforeEach(async () => {
  parentDir = await mkdtemp(join(tmpdir(), 'sophia-db-sync-'))
  dataRoot = join(parentDir, 'data')
  await mkdir(dataRoot, { recursive: true })
})

afterEach(async () => {
  await rm(parentDir, { recursive: true, force: true })
})

// Create a minimal valid SQLite database header
function createSQLiteHeader(): Buffer {
  const header = Buffer.alloc(100)
  // SQLite magic string
  header.write('SQLite format 3\0', 0, 16, 'utf8')
  // Page size: 4096 (0x1000)
  header.writeUInt16BE(4096, 16)
  // File format versions (Legacy mode)
  header.writeUInt8(1, 18)
  header.writeUInt8(1, 19)
  return header
}

/**
 * Build a REAL SQLite database file on disk using the system CLI. Some
 * validation tests need a file that survives PRAGMA integrity_check —
 * a hand-forged header buffer no longer does.
 */
function createRealSqliteDb(path: string): void {
  execFileSync('sqlite3', [path, 'CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);'], {
    stdio: 'ignore',
    timeout: 10000
  })
}

describe('DatabaseSyncManager — validation', () => {
  it('rejects non-existent file', async () => {
    const manager = makeManager(dataRoot)
    const result = await manager.validateDatabase(join(dataRoot, 'nonexistent.db'))
    
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('does not exist')
  })

  it('rejects file too small', async () => {
    const manager = makeManager(dataRoot)
    const smallFile = join(dataRoot, 'small.db')
    await writeFile(smallFile, Buffer.alloc(100)) // Less than 1KB
    
    const result = await manager.validateDatabase(smallFile)
    
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('too small')
  })

  it('rejects non-SQLite file', async () => {
    const manager = makeManager(dataRoot)
    const notSqlite = join(dataRoot, 'notsqlite.db')
    await writeFile(notSqlite, Buffer.alloc(2048)) // Fills with zeros
    
    const result = await manager.validateDatabase(notSqlite)
    
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Not a valid SQLite')
  })

  it('accepts valid SQLite header', async () => {
    const manager = makeManager(dataRoot)
    const validDb = join(dataRoot, 'valid.db')

    if (hasSqliteCli) {
      // With the CLI installed, header-only fakes are rejected by PRAGMA
      // integrity_check (as they should be). Use a real database.
      createRealSqliteDb(validDb)
    } else {
      const header = createSQLiteHeader()
      const content = Buffer.concat([header, Buffer.alloc(2048)]) // Pad to >1KB
      await writeFile(validDb, content)
    }

    const result = await manager.validateDatabase(validDb)

    expect(result.isValid).toBe(true)
  })
})

describe('DatabaseSyncManager — backup management', () => {
  it('creates backup of existing database', async () => {
    const manager = makeManager(dataRoot)
    const dbPath = join(dataRoot, 'app.db')
    await writeFile(dbPath, 'test database content')
    
    const backupPath = await manager.createBackup()
    
    expect(backupPath).toContain('backup_database_')
    expect(await readFile(backupPath, 'utf-8')).toBe('test database content')
  })

  it('creates backup directory if not exists', async () => {
    const manager = makeManager(dataRoot)
    const newRoot = join(parentDir, 'new-root')
    await mkdir(newRoot, { recursive: true })
    const newManager = new DatabaseSyncManager(newRoot)
    
    await writeFile(join(newRoot, 'app.db'), 'test content')
    
    const backupPath = await newManager.createBackup()
    
    expect(backupPath).toContain('backup_database_')
    await expect(access(backupPath)).resolves.toBeUndefined()
  })

  it('keeps only MAX_BACKUP_COUNT backups', async () => {
    const manager = makeManager(dataRoot)
    
    // Create 5 backups
    for (let i = 0; i < 5; i++) {
      await writeFile(join(dataRoot, 'app.db'), `content ${i}`)
      await manager.createBackup()
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    
    // Cleanup should keep only 3
    await manager.cleanupOldBackups()
    
    const backups = await manager.getAvailableBackups()
    expect(backups.length).toBeLessThanOrEqual(3)
  })

  it('lists backups sorted newest first', async () => {
    const manager = makeManager(dataRoot)
    
    // Create 3 backups
    for (let i = 0; i < 3; i++) {
      await writeFile(join(dataRoot, 'app.db'), `content ${i}`)
      await manager.createBackup()
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    
    const backups = await manager.getAvailableBackups()
    
    expect(backups.length).toBe(3)
    // Should be sorted descending (newest first)
    expect(backups[0] > backups[1]).toBe(true)
    expect(backups[1] > backups[2]).toBe(true)
  })
})

describe('DatabaseSyncManager — WAL file handling', () => {
  it('cleans up WAL files', async () => {
    const manager = makeManager(dataRoot)
    const dbPath = join(dataRoot, 'app.db')
    
    await writeFile(dbPath, 'database content')
    await writeFile(`${dbPath}-wal`, 'WAL content')
    await writeFile(`${dbPath}-shm`, 'SHM content')
    
    expect(manager.hasWalFiles(dbPath)).toBe(true)
    
    await manager.cleanupWalFiles(dbPath)
    
    expect(manager.hasWalFiles(dbPath)).toBe(false)
  })

  it('handles missing WAL files gracefully', async () => {
    const manager = makeManager(dataRoot)
    const dbPath = join(dataRoot, 'app.db')
    
    await writeFile(dbPath, 'database content')
    
    // Should not throw
    await manager.cleanupWalFiles(dbPath)
    
    expect(manager.hasWalFiles(dbPath)).toBe(false)
  })
})

describe('DatabaseSyncManager — atomic replace', () => {
  it('replaces database atomically', async () => {
    const manager = makeManager(dataRoot)
    const dbPath = join(dataRoot, 'app.db')
    const tempPath = join(dataRoot, '.sync-cache', 'temp.db')
    
    await mkdir(join(dataRoot, '.sync-cache'), { recursive: true })
    await writeFile(dbPath, 'old content')
    await writeFile(tempPath, 'new content')
    await writeFile(`${dbPath}-wal`, 'WAL data')
    
    await manager.atomicReplaceDatabase(tempPath)
    
    expect(await readFile(dbPath, 'utf-8')).toBe('new content')
    expect(manager.hasWalFiles(dbPath)).toBe(false)
  })
})

describe('DatabaseSyncManager — safe download', () => {
  it('downloads and validates database', async () => {
    const manager = makeManager(dataRoot)
    const fake = new FakeClient()

    let content: Buffer
    if (hasSqliteCli) {
      // Need a real DB body — PRAGMA integrity_check runs on the downloaded
      // temp file, and a header-only fake would be rejected.
      const seed = join(dataRoot, 'seed.db')
      createRealSqliteDb(seed)
      content = await readFile(seed)
      await rm(seed, { force: true })
    } else {
      const header = createSQLiteHeader()
      content = Buffer.concat([header, Buffer.alloc(2048)])
    }
    fake.setRemote('/sophia/app.db', content)

    const result = await manager.safeDownloadDatabase(
      fake as unknown as any,
      '/sophia/app.db'
    )

    expect(result.success).toBe(true)
    expect(result.message).toContain('successfully')
    expect(fake.downloads).toHaveLength(1)

    // Verify local database exists and is valid
    const localDb = join(dataRoot, 'app.db')
    await expect(access(localDb)).resolves.toBeUndefined()
  })

  it('rejects invalid database file', async () => {
    const manager = makeManager(dataRoot)
    const fake = new FakeClient()
    
    // Create invalid content on remote
    fake.setRemote('/sophia/app.db', 'not a database')
    
    const result = await manager.safeDownloadDatabase(
      fake as unknown as any,
      '/sophia/app.db'
    )
    
    expect(result.success).toBe(false)
    expect(result.failureType).toBe(DatabaseSyncFailureType.ValidationFailed)
  })

  it('creates backup before replacement', async () => {
    const manager = makeManager(dataRoot)
    const fake = new FakeClient()

    // Create existing local database
    await writeFile(join(dataRoot, 'app.db'), 'old database')

    let content: Buffer
    if (hasSqliteCli) {
      const seed = join(dataRoot, 'seed.db')
      createRealSqliteDb(seed)
      content = await readFile(seed)
      await rm(seed, { force: true })
    } else {
      const header = createSQLiteHeader()
      content = Buffer.concat([header, Buffer.alloc(2048)])
    }
    fake.setRemote('/sophia/app.db', content)

    await manager.safeDownloadDatabase(
      fake as unknown as any,
      '/sophia/app.db'
    )

    // Should have created a backup
    const backups = await manager.getAvailableBackups()
    expect(backups.length).toBe(1)
  })
})

describe('DatabaseSyncManager — snapshot for upload', () => {
  it('creates snapshot of existing database', async () => {
    const manager = makeManager(dataRoot)
    const dbPath = join(dataRoot, 'app.db')
    
    await writeFile(dbPath, 'database to upload')
    
    const snapshotPath = await manager.prepareUploadSnapshot()
    
    expect(snapshotPath).toContain('snapshot_')
    expect(await readFile(snapshotPath, 'utf-8')).toBe('database to upload')
    
    // Cleanup
    await rm(snapshotPath)
  })

  it('throws if database does not exist', async () => {
    const manager = makeManager(dataRoot)
    
    await expect(manager.prepareUploadSnapshot()).rejects.toThrow('does not exist')
  })
})

describe('DatabaseSyncManager — restore from backup', () => {
  it('restores database from backup', async () => {
    const manager = makeManager(dataRoot)
    const dbPath = join(dataRoot, 'app.db')
    
    // Create backup with known content
    await writeFile(dbPath, 'backup content')
    const backupPath = await manager.createBackup()
    
    // Modify the database
    await writeFile(dbPath, 'modified content')
    expect(await readFile(dbPath, 'utf-8')).toBe('modified content')
    
    // Restore from backup
    await manager.recoverFromBackup(backupPath)
    
    expect(await readFile(dbPath, 'utf-8')).toBe('backup content')
  })
})

describe('DatabaseSyncManager — header patching', () => {
  it('patches WAL mode header to Legacy', async () => {
    const manager = makeManager(dataRoot)
    const dbPath = join(dataRoot, 'wal.db')
    
    // Create file with WAL mode header
    const header = Buffer.alloc(100)
    header.write('SQLite format 3\0', 0, 16, 'utf8')
    header.writeUInt16BE(4096, 16)
    header.writeUInt8(2, 18) // WAL write version
    header.writeUInt8(2, 19) // WAL read version
    const content = Buffer.concat([header, Buffer.alloc(2048)])
    await writeFile(dbPath, content)
    
    await manager.fixDatabaseHeader(dbPath)
    
    // Verify header was patched
    const patchedContent = await readFile(dbPath)
    expect(patchedContent[18]).toBe(1) // Legacy write version
    expect(patchedContent[19]).toBe(1) // Legacy read version
  })
})