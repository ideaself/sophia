import { readFile, writeFile, mkdir, rm, stat, readdir, copyFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { execFile } from 'node:child_process'
import { SyncWebDavClient, type WebDavConfig } from './webdav-client'

const TEMP_DB_PREFIX = 'temp_database_'
const BACKUP_DB_PREFIX = 'backup_database_'
const MAX_BACKUP_COUNT = 3

export interface DatabaseSyncResult {
  success: boolean
  message: string
  failureType?: DatabaseSyncFailureType
}

export interface DatabaseValidationResult {
  isValid: boolean
  error?: string
}

export enum DatabaseSyncFailureType {
  DownloadFailed = 'downloadFailed',
  ValidationFailed = 'validationFailed',
  ReplacementFailed = 'replacementFailed',
}

/**
 * Database safe sync manager
 * Provides safe database download, validation and recovery mechanisms
 */
export class DatabaseSyncManager {
  private readonly cacheDir: string
  private readonly localDbPath: string
  // Cached probe: null = not yet checked, true = installed, false = not installed.
  // Avoids repeated ENOENT execFile spam on machines without the CLI (typical
  // on Windows). The result never changes within a process lifetime.
  private sqliteCliAvailable: boolean | null = null

  constructor(dataRoot: string) {
    this.cacheDir = join(dataRoot, '.sync-cache')
    this.localDbPath = join(dataRoot, 'app.db')
  }

  /** One-shot detection of the system sqlite3 CLI; result is cached. */
  private async detectSqliteCli(): Promise<boolean> {
    if (this.sqliteCliAvailable !== null) return this.sqliteCliAvailable
    this.sqliteCliAvailable = await new Promise<boolean>((resolve) => {
      execFile('sqlite3', ['-version'], { timeout: 5000 }, (err) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ENOENT') {
            console.warn('DatabaseSync: system `sqlite3` CLI not installed — deep integrity checks and VACUUM INTO will be skipped; header validation + file copy fallback will be used instead')
          } else {
            console.warn('DatabaseSync: `sqlite3 -version` failed:', err.message)
          }
          resolve(false)
        } else {
          resolve(true)
        }
      })
    })
    return this.sqliteCliAvailable
  }

  /**
   * Safe database download
   *
   * Process:
   * 1. Download to cache temp file
   * 2. Validate database integrity
   * 3. Backup current database
   * 4. Atomic replace database
   * 5. Validate replacement result
   */
  async safeDownloadDatabase(
    client: SyncWebDavClient,
    remoteDbFileName: string,
    onProgress?: (received: number, total: number) => void
  ): Promise<DatabaseSyncResult> {
    // Generate temp file name (use timestamp to ensure uniqueness)
    const timestamp = Date.now()
    const tempDbName = `${TEMP_DB_PREFIX}${timestamp}.db`
    const tempDbPath = join(this.cacheDir, tempDbName)

    try {
      console.log('DatabaseSync: Starting safe database download')
      console.log('DatabaseSync: Remote file:', remoteDbFileName)
      console.log('DatabaseSync: Temp file:', tempDbPath)

      // Ensure cache directory exists
      await mkdir(this.cacheDir, { recursive: true })

      // Step 1: Download to temp file
      await client.downloadToFile(remoteDbFileName, tempDbPath)

      console.log('DatabaseSync: Download completed, starting validation')

      // Step 2: Validate downloaded database
      const validationResult = await this.validateDatabase(tempDbPath)
      if (!validationResult.isValid) {
        await this.cleanupTempFile(tempDbPath)
        return {
          success: false,
          message: `Database validation failed: ${validationResult.error}`,
          failureType: DatabaseSyncFailureType.ValidationFailed,
        }
      }

      console.log('DatabaseSync: Validation passed, proceeding with replacement')

      // Step 3: Backup current database
      const backupPath = await this.createBackup()
      console.log('DatabaseSync: Created backup at:', backupPath)

      // Step 4: Atomic replace database
      await this.atomicReplaceDatabase(tempDbPath)

      // Step 5: Validate replaced database
      const finalValidation = await this.validateDatabase(this.localDbPath)
      if (!finalValidation.isValid) {
        console.log('DatabaseSync: Final validation failed, recovering from backup')
        await this.recoverFromBackup(backupPath)
        return {
          success: false,
          message: 'Database replacement validation failed, recovered from backup',
          failureType: DatabaseSyncFailureType.ReplacementFailed,
        }
      }

      // Step 6: Cleanup and maintain backups
      await this.cleanupOldBackups()
      await this.cleanupTempFile(tempDbPath)

      console.log('DatabaseSync: Safe database download completed successfully')
      return {
        success: true,
        message: 'Database synchronized successfully',
      }
    } catch (e) {
      console.error('DatabaseSync: Error during safe download:', e)
      await this.cleanupTempFile(tempDbPath)

      return {
        success: false,
        message: `Database sync failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        failureType: DatabaseSyncFailureType.DownloadFailed,
      }
    }
  }

  /**
   * Run PRAGMA integrity_check on a SQLite database using the system sqlite3 CLI.
   * This mirrors anxreader's approach of running integrity checks before accepting
   * a downloaded database.
   *
   * Return semantics:
   *   { ok: true,  available: true  } — CLI ran and the database is intact
   *   { ok: false, available: true  } — CLI ran and the database is CORRUPT (reject!)
   *   { ok: true,  available: false } — CLI unavailable; header validation is our only defense
   */
  private async runIntegrityCheck(dbPath: string): Promise<{ ok: boolean; available: boolean; error?: string }> {
    if (!(await this.detectSqliteCli())) {
      return { ok: true, available: false }
    }
    try {
      const result = await new Promise<{ stdout: string; stderr: string; failed?: 'runtime' }>((resolve) => {
        execFile('sqlite3', [dbPath, 'PRAGMA integrity_check;'], {
          timeout: 30000,
          maxBuffer: 1024 * 1024
        }, (err, stdout, stderr) => {
          if (err) {
            // We already know the CLI exists; any failure here is a runtime
            // problem (bad DB, timeout, permission, ...).
            resolve({ stdout, stderr, failed: 'runtime' })
          } else {
            resolve({ stdout, stderr })
          }
        })
      })

      const output = result.stdout.trim()
      if (output === 'ok') {
        return { ok: true, available: true }
      }
      return {
        ok: false,
        available: true,
        error: output || result.stderr.trim() || 'sqlite3 integrity_check failed'
      }
    } catch (e) {
      console.warn('DatabaseSync: Integrity check unexpectedly threw:', e instanceof Error ? e.message : String(e))
      return { ok: true, available: false }
    }
  }

  /**
   * Create a transactionally-consistent database snapshot using VACUUM INTO.
   * Falls back to file copy + WAL fix if sqlite3 CLI is unavailable.
   * This mirrors anxreader's approach of using VACUUM INTO for snapshot uploads.
   */
  private async createConsistentSnapshot(targetPath: string): Promise<boolean> {
    // If the CLI isn't installed, don't even try — go straight to the file
    // copy fallback. This avoids a noisy ENOENT on every sync.
    if (await this.detectSqliteCli()) {
      try {
        await new Promise<void>((resolve, reject) => {
          execFile('sqlite3', [this.localDbPath, `VACUUM INTO '${targetPath.replace(/'/g, "''")}';`], {
            timeout: 60000
          }, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
        return true
      } catch (e) {
        console.warn('DatabaseSync: VACUUM INTO failed, falling back to file copy:', e)
      }
    }
    try {
      await copyFile(this.localDbPath, targetPath)
      await this.fixDatabaseHeader(targetPath)
      return true
    } catch (copyErr) {
      console.error('DatabaseSync: Copy fallback also failed:', copyErr)
      return false
    }
  }

  /**
   * Validate database integrity — header checks followed by best-effort
   * PRAGMA integrity_check (via system sqlite3 CLI, if available).
   * This mirrors anxreader's multi-layer validation approach.
   *
   * The PRAGMA check is best-effort: if sqlite3 CLI is unavailable or the
   * database can't be opened (e.g. it's a minimal test fixture), header
   * validation is sufficient.
   */
  async validateDatabase(dbPath: string): Promise<DatabaseValidationResult> {
    try {
      // Check if file exists and is not empty
      if (!existsSync(dbPath)) {
        return { isValid: false, error: 'Database file does not exist' }
      }

      const fileInfo = await stat(dbPath)
      if (fileInfo.size < 1024) {
        // Database file should be at least 1KB
        return { isValid: false, error: `Database file too small: ${fileInfo.size}B` }
      }

      // Read and validate SQLite header
      const header = Buffer.alloc(100)
      const fileHandle = await import('node:fs/promises').then(fs => 
        fs.open(dbPath, 'r')
      )
      try {
        await fileHandle.read(header, 0, 100, 0)
      } finally {
        await fileHandle.close()
      }

      // Check SQLite magic string
      const magicString = header.toString('utf8', 0, 16)
      if (!magicString.startsWith('SQLite format 3')) {
        return { isValid: false, error: 'Not a valid SQLite database file' }
      }

      // Check page size (should be power of 2 between 512 and 65536)
      const pageSize = header.readUInt16BE(16)
      if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) {
        return { isValid: false, error: `Invalid page size: ${pageSize}` }
      }

      // Check file format version
      const writeVersion = header.readUInt8(18)
      const readVersion = header.readUInt8(19)
      if (writeVersion > 2 || readVersion > 2) {
        return { isValid: false, error: `Unsupported file format version: write=${writeVersion}, read=${readVersion}` }
      }

      // Layered integrity check via system sqlite3 CLI (like anxreader). If
      // the CLI is unavailable, header validation is our only defense — sync
      // still proceeds. But if the CLI ran and reported CORRUPTION, we must
      // reject: a corrupt DB that passes the header check will silently
      // clobber the local database on atomicReplaceDatabase().
      const integrity = await this.runIntegrityCheck(dbPath)
      if (integrity.available && !integrity.ok) {
        return {
          isValid: false,
          error: `PRAGMA integrity_check failed: ${integrity.error ?? 'unknown'}`
        }
      }
      if (!integrity.available) {
        console.warn(`DatabaseSync: sqlite3 CLI unavailable — skipped deep integrity check for ${dbPath}`)
      }

      console.log('DatabaseSync: Validation passed for', dbPath)
      return { isValid: true }
    } catch (e) {
      return { isValid: false, error: `Database validation error: ${e}` }
    }
  }

  /**
   * Create database backup
   */
  async createBackup(): Promise<string> {
    await mkdir(this.cacheDir, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupName = `${BACKUP_DB_PREFIX}${timestamp}.db`
    const backupPath = join(this.cacheDir, backupName)

    if (existsSync(this.localDbPath)) {
      await copyFile(this.localDbPath, backupPath)
    }

    return backupPath
  }

  /**
   * Atomic replace database
   */
  async atomicReplaceDatabase(tempDbPath: string): Promise<void> {
    // Clean up WAL files before replacement
    await this.cleanupWalFiles()

    // Copy temp file to local database path
    await copyFile(tempDbPath, this.localDbPath)

    // Clean up WAL files again after replacement
    await this.cleanupWalFiles()
  }

  /**
   * Recover database from backup
   */
  async recoverFromBackup(backupPath: string): Promise<void> {
    try {
      // Clean up WAL files before recovery
      await this.cleanupWalFiles()

      if (existsSync(backupPath)) {
        await copyFile(backupPath, this.localDbPath)
      }

      // Clean up WAL files after recovery
      await this.cleanupWalFiles()

      console.log('DatabaseSync: Successfully recovered from backup:', backupPath)
    } catch (e) {
      console.error('DatabaseSync: Failed to recover from backup:', e)
      throw e
    }
  }

  /**
   * Cleanup temp file
   */
  async cleanupTempFile(tempDbPath: string): Promise<void> {
    try {
      if (existsSync(tempDbPath)) {
        await unlink(tempDbPath)
        console.log('DatabaseSync: Cleaned up temp file:', tempDbPath)
      }
    } catch (e) {
      console.warn('DatabaseSync: Failed to cleanup temp file:', e)
    }
  }

  /**
   * Cleanup expired backup files
   */
  async cleanupOldBackups(): Promise<void> {
    try {
      if (!existsSync(this.cacheDir)) return

      const files = await readdir(this.cacheDir)
      const backupFiles = files
        .filter(file => file.startsWith(BACKUP_DB_PREFIX))
        .map(file => ({
          name: file,
          path: join(this.cacheDir, file),
          mtime: 0
        }))

      // Get modification times
      for (const file of backupFiles) {
        const fileInfo = await stat(file.path)
        file.mtime = fileInfo.mtimeMs
      }

      // Sort by modification time (newest first)
      backupFiles.sort((a, b) => b.mtime - a.mtime)

      // Keep only the latest backups
      if (backupFiles.length > MAX_BACKUP_COUNT) {
        const filesToDelete = backupFiles.slice(MAX_BACKUP_COUNT)
        for (const file of filesToDelete) {
          await unlink(file.path)
          console.log('DatabaseSync: Cleaned up old backup:', file.path)
        }
      }
    } catch (e) {
      console.warn('DatabaseSync: Failed to cleanup old backups:', e)
    }
  }

  /**
   * Get WAL file paths for a database
   */
  private getWalPaths(dbPath: string): { wal: string; shm: string } {
    return {
      wal: `${dbPath}-wal`,
      shm: `${dbPath}-shm`,
    }
  }

  /**
   * Check if WAL files exist
   */
  hasWalFiles(dbPath: string): boolean {
    const { wal } = this.getWalPaths(dbPath)
    return existsSync(wal)
  }

  /**
   * Cleanup WAL auxiliary files
   */
  async cleanupWalFiles(dbPath?: string): Promise<void> {
    const targetPath = dbPath || this.localDbPath
    const { wal, shm } = this.getWalPaths(targetPath)

    try {
      if (existsSync(wal)) await unlink(wal)
      if (existsSync(shm)) await unlink(shm)
      console.log('DatabaseSync: WAL files cleaned up')
    } catch (e) {
      console.warn('DatabaseSync: Failed to cleanup WAL files:', e)
    }
  }

  /**
   * Prepare database snapshot for upload
   * Creates a transactionally-consistent copy using VACUUM INTO (like anxreader),
   * falling back to file copy + WAL fix if the sqlite3 CLI is unavailable.
   */
  async prepareUploadSnapshot(): Promise<string> {
    await mkdir(this.cacheDir, { recursive: true })

    const timestamp = Date.now()
    const snapshotPath = join(this.cacheDir, `snapshot_${timestamp}.db`)

    if (!existsSync(this.localDbPath)) {
      throw new Error('Local database does not exist')
    }

    // Use VACUUM INTO for a consistent snapshot, fall back to copy + WAL fix
    const created = await this.createConsistentSnapshot(snapshotPath)
    if (!created) {
      throw new Error('Failed to create database snapshot')
    }

    return snapshotPath
  }

  /**
   * Fix database header to ensure compatibility
   * Patches the file header to switch from WAL mode to Legacy mode if needed
   */
  async fixDatabaseHeader(dbPath: string): Promise<void> {
    try {
      if (!existsSync(dbPath)) return

      const fileHandle = await import('node:fs/promises').then(fs => 
        fs.open(dbPath, 'r+')
      )
      
      try {
        // Read header bytes 18 and 19 (file format version)
        const header = Buffer.alloc(20)
        await fileHandle.read(header, 0, 20, 0)

        const writeVersion = header.readUInt8(18)
        const readVersion = header.readUInt8(19)

        // Check if patching is needed (WAL mode uses version 2)
        if (writeVersion === 2 || readVersion === 2) {
          // Patch to Legacy mode (version 1)
          const patchBuffer = Buffer.from([1, 1])
          await fileHandle.write(patchBuffer, 0, 2, 18)
          console.log('DatabaseSync: Patched database header from WAL to Legacy mode')
        }
      } finally {
        await fileHandle.close()
      }
    } catch (e) {
      console.warn('DatabaseSync: Failed to fix database header:', e)
    }
  }

  /**
   * Get available backup files
   */
  async getAvailableBackups(): Promise<string[]> {
    try {
      if (!existsSync(this.cacheDir)) return []

      const files = await readdir(this.cacheDir)
      const backupFiles = files
        .filter(file => file.startsWith(BACKUP_DB_PREFIX))
        .map(file => join(this.cacheDir, file))

      // Sort by name (which includes timestamp)
      backupFiles.sort((a, b) => b.localeCompare(a))
      return backupFiles
    } catch (e) {
      console.warn('DatabaseSync: Failed to get available backups:', e)
      return []
    }
  }
}