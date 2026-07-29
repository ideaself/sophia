import { readFile, writeFile, mkdir, rm, stat, readdir, rmdir, rename, copyFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { dirname, join, extname, resolve, sep } from 'node:path'
import { SyncWebDavClient, type WebDavConfig, type WebDavRemoteFile } from './webdav-client'
import { collectSyncableFiles, isSyncableRelPath, type SyncableFile } from './file-walker'
import { runPool } from './async-pool'
import {
  loadSyncState,
  saveSyncState,
  emptySyncState,
  type SyncState
} from './sync-state'
import { DatabaseSyncManager, type DatabaseSyncResult } from './database-sync-manager'

const REMOTE_PREFIX = '/sophia'

export interface SyncResult {
  success: boolean
  /** Files actually transferred in this run */
  transferred: number
  /** Files skipped because both sides matched the last-sync record */
  skipped: number
  /** Files deleted on the target side (previously synced, gone from source) */
  deleted: number
  errors: string[]
}

export interface SyncPlanSummary {
  transferCount: number
  skipCount: number
  deleteCount: number
  /** Up to 20 paths that would be deleted, for the confirm dialog */
  deleteSample: string[]
}

export interface SyncProgress {
  direction: 'push' | 'pull'
  /** 1-based index of the file currently being transferred or deleted */
  current: number
  total: number
  /** Path relative to the data root, suitable for display */
  file: string
}

export type SyncProgressCallback = (progress: SyncProgress) => void

/**
 * A server-supplied relative path is only safe to write under dataRoot if it
 * is non-empty, not absolute, and contains no `..` segments.
 */
function isSafeRelativePath(relPath: string): boolean {
  if (!relPath) return false
  if (relPath.startsWith('/') || relPath.startsWith('\\')) return false
  if (/^[a-zA-Z]:/.test(relPath)) return false
  return !relPath.split(/[/\\]/).includes('..')
}

/** Extensions synced as raw bytes instead of utf-8 text. */
const BINARY_EXTENSIONS = new Set(['.pdf', '.epub', '.mobi'])

/**
 * Concurrent transfers / listings during one sync run. Kept low: common
 * WebDAV hosts (e.g. 坚果云) rate-limit bursty clients.
 */
const SYNC_CONCURRENCY = 4

function isBinaryFile(relPath: string): boolean {
  return BINARY_EXTENSIONS.has(extname(relPath).toLowerCase())
}

function stripPrefix(remotePath: string): string {
  return remotePath.startsWith(REMOTE_PREFIX + '/')
    ? remotePath.slice(REMOTE_PREFIX.length + 1)
    : remotePath
}

interface FileTransfer {
  relPath: string
  localPath: string
  remotePath: string
}

interface PushPlan {
  uploads: FileTransfer[]
  remoteDeletions: FileTransfer[]
  skipped: number
}

interface PullPlan {
  downloads: FileTransfer[]
  localDeletions: FileTransfer[]
  unsafePaths: string[]
  skipped: number
}

interface LocalFileStat {
  size: number
  mtimeMs: number
}

export class SyncManager {
  private readonly databaseSyncManager: DatabaseSyncManager

  constructor(private readonly dataRoot: string) {
    this.databaseSyncManager = new DatabaseSyncManager(dataRoot)
  }

  private createClient(config: WebDavConfig): SyncWebDavClient {
    return new SyncWebDavClient(config)
  }

  async test(config: WebDavConfig): Promise<{ success: boolean; message?: string }> {
    const client = this.createClient(config)
    return client.test()
  }

  /**
   * Sync database file with safe download, validation, and recovery
   */
  async syncDatabase(
    config: WebDavConfig,
    direction: 'push' | 'pull',
    onProgress?: (received: number, total: number) => void
  ): Promise<DatabaseSyncResult> {
    const client = this.createClient(config)
    const remoteDbPath = `${REMOTE_PREFIX}/app.db`

    if (direction === 'pull') {
      return this.databaseSyncManager.safeDownloadDatabase(client, remoteDbPath, onProgress)
    } else {
      // Push: create snapshot and upload
      try {
        const snapshotPath = await this.databaseSyncManager.prepareUploadSnapshot()
        await client.uploadFile(remoteDbPath, createReadStream(snapshotPath))
        await this.databaseSyncManager.cleanupTempFile(snapshotPath)
        return { success: true, message: 'Database uploaded successfully' }
      } catch (e) {
        return {
          success: false,
          message: `Database upload failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
          failureType: undefined,
        }
      }
    }
  }

  /**
   * Get available database backups
   */
  async getDatabaseBackups(): Promise<string[]> {
    return this.databaseSyncManager.getAvailableBackups()
  }

  /**
   * Restore database from backup
   */
  async restoreDatabaseFromBackup(backupPath: string): Promise<DatabaseSyncResult> {
    try {
      await this.databaseSyncManager.recoverFromBackup(backupPath)
      return { success: true, message: 'Database restored successfully' }
    } catch (e) {
      return {
        success: false,
        message: `Database restore failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        failureType: undefined,
      }
    }
  }

  /**
   * Validate local database integrity
   */
  async validateLocalDatabase(): Promise<{ isValid: boolean; error?: string }> {
    return this.databaseSyncManager.validateDatabase(
      join(this.dataRoot, 'app.db')
    )
  }

  private async statLocal(relPath: string): Promise<LocalFileStat | null> {
    try {
      const s = await stat(join(this.dataRoot, relPath))
      return { size: s.size, mtimeMs: s.mtimeMs }
    } catch {
      return null
    }
  }

  /**
   * Load the sync state, or — on first run — seed it from the remote
   * listing. Seeding marks every syncable remote file as "previously synced"
   * so the very first push can clean up junk left by the old full-upload
   * sync, while local files (localSize null ≠ actual stat) are all
   * (re)uploaded. Non-syncable remote files are not seeded — the push plan
   * deletes them outright as junk.
   */
  private async loadStateForPush(remoteList: WebDavRemoteFile[]): Promise<SyncState> {
    const state = await loadSyncState(this.dataRoot)
    if (state) return state
    const seeded = emptySyncState()
    for (const f of remoteList) {
      const rel = stripPrefix(f.path)
      if (!isSyncableRelPath(rel)) continue
      seeded.files[rel] = {
        localSize: null,
        localMtimeMs: null,
        remoteSize: f.size,
        remoteLastmod: f.lastmod
      }
    }
    return seeded
  }

  private async buildPushPlan(client: SyncWebDavClient): Promise<PushPlan> {
    const localFiles = await collectSyncableFiles(this.dataRoot)
    const remoteList = await client.listAllFilesDetailed(REMOTE_PREFIX)
    const state = await this.loadStateForPush(remoteList)
    const remoteByRel = new Map(remoteList.map((f) => [stripPrefix(f.path), f]))
    const localRelSet = new Set(localFiles.map((f) => f.relativePath))

    const uploads: FileTransfer[] = []
    let skipped = 0
    for (const file of localFiles) {
      const rel = file.relativePath
      const entry = state.files[rel]
      const remote = remoteByRel.get(rel)
      const local = await this.statLocal(rel)
      const unchanged =
        entry !== undefined &&
        remote !== undefined &&
        local !== null &&
        entry.localSize === local.size &&
        entry.localMtimeMs === local.mtimeMs &&
        entry.remoteSize === remote.size &&
        entry.remoteLastmod === remote.lastmod
      if (unchanged) {
        skipped++
      } else {
        uploads.push({ relPath: rel, localPath: file.localPath, remotePath: REMOTE_PREFIX + '/' + rel })
      }
    }

    // Mirror deletion. Two kinds of remote files are removed:
    // - previously-synced files that are gone locally (recorded in state);
    // - junk that fails the sync-set rules (sync-state.json, config/*.enc
    //   uploaded by old versions) — deleted outright, no state needed.
    // Valid remote files we know nothing about are left alone.
    const remoteDeletions: FileTransfer[] = []
    for (const [rel, remote] of remoteByRel) {
      if (localRelSet.has(rel)) continue
      if (isSyncableRelPath(rel) && !(rel in state.files)) continue
      remoteDeletions.push({ relPath: rel, localPath: '', remotePath: remote.path })
    }

    return { uploads, remoteDeletions, skipped }
  }

  private async buildPullPlan(client: SyncWebDavClient): Promise<PullPlan> {
    const remoteList = await client.listAllFilesDetailed(REMOTE_PREFIX)
    // No seeding on pull: without a state record nothing local is ever deleted.
    const state = (await loadSyncState(this.dataRoot)) ?? emptySyncState()

    const downloads: FileTransfer[] = []
    const unsafePaths: string[] = []
    let skipped = 0
    const remoteRelSet = new Set<string>()

    for (const remote of remoteList) {
      const rel = stripPrefix(remote.path)
      if (!isSafeRelativePath(rel)) {
        unsafePaths.push(rel)
        continue
      }
      // The sync set is defined by the app, not by whatever is on the
      // server: junk left by old versions (sync-state.json, config/*.enc)
      // is never downloaded. It is also kept OUT of remoteRelSet, so a
      // previously-synced copy on disk gets cleaned up by mirror deletion.
      if (!isSyncableRelPath(rel)) continue
      remoteRelSet.add(rel)
      const entry = state.files[rel]
      const local = await this.statLocal(rel)
      const unchanged =
        entry !== undefined &&
        local !== null &&
        entry.remoteSize === remote.size &&
        entry.remoteLastmod === remote.lastmod &&
        entry.localSize === local.size &&
        entry.localMtimeMs === local.mtimeMs
      if (unchanged) {
        skipped++
      } else {
        downloads.push({ relPath: rel, localPath: join(this.dataRoot, rel), remotePath: remote.path })
      }
    }

    // Mirror deletion: only previously-synced local files whose remote
    // counterpart vanished are deleted. Never-synced local files are safe.
    const localDeletions: FileTransfer[] = []
    for (const rel of Object.keys(state.files)) {
      if (remoteRelSet.has(rel)) continue
      if (!isSafeRelativePath(rel)) continue
      if (await this.statLocal(rel)) {
        localDeletions.push({ relPath: rel, localPath: join(this.dataRoot, rel), remotePath: '' })
      }
    }

    return { downloads, localDeletions, unsafePaths, skipped }
  }

  /** After a push, rebuild state from local disk + a fresh remote listing. */
  private async rebuildStateAfterPush(client: SyncWebDavClient): Promise<void> {
    const localFiles = await collectSyncableFiles(this.dataRoot)
    const remoteList = await client.listAllFilesDetailed(REMOTE_PREFIX)
    const remoteByRel = new Map(remoteList.map((f) => [stripPrefix(f.path), f]))
    const state = emptySyncState()
    for (const file of localFiles) {
      const local = await this.statLocal(file.relativePath)
      const remote = remoteByRel.get(file.relativePath)
      state.files[file.relativePath] = {
        localSize: local?.size ?? null,
        localMtimeMs: local?.mtimeMs ?? null,
        remoteSize: remote?.size ?? null,
        remoteLastmod: remote?.lastmod ?? null
      }
    }
    await saveSyncState(this.dataRoot, state)
  }

  /** After a pull, rebuild state from the remote listing + local disk. */
  private async rebuildStateAfterPull(client: SyncWebDavClient): Promise<void> {
    const remoteList = await client.listAllFilesDetailed(REMOTE_PREFIX)
    const state = emptySyncState()
    for (const remote of remoteList) {
      const rel = stripPrefix(remote.path)
      if (!isSafeRelativePath(rel)) continue
      if (!isSyncableRelPath(rel)) continue
      const local = await this.statLocal(rel)
      state.files[rel] = {
        localSize: local?.size ?? null,
        localMtimeMs: local?.mtimeMs ?? null,
        remoteSize: remote.size,
        remoteLastmod: remote.lastmod
      }
    }
    await saveSyncState(this.dataRoot, state)
  }

  /**
   * Remove remote directories left empty by `deletedRemotePaths`, deepest
   * first. WebDAV DELETE on a non-empty collection may delete its contents
   * recursively, so emptiness is verified with a fresh listing first.
   */
  private async pruneEmptyRemoteDirs(
    client: SyncWebDavClient,
    deletedRemotePaths: string[]
  ): Promise<void> {
    const candidates = new Set<string>()
    for (const p of deletedRemotePaths) {
      let dir = dirname(p).replace(/\\/g, '/')
      // REMOTE_PREFIX itself is never a candidate
      while (dir.startsWith(REMOTE_PREFIX + '/')) {
        candidates.add(dir)
        dir = dirname(dir)
      }
    }
    const deepestFirst = [...candidates].sort((a, b) => b.length - a.length)
    for (const dir of deepestFirst) {
      try {
        const entries = await client.listFiles(dir)
        if (entries.length === 0) await client.deleteFile(dir)
      } catch {
        // Best effort — a leftover empty directory is harmless
      }
    }
  }

  /** Remove local directories left empty by `deletedLocalPaths`, up to dataRoot. */
  private async pruneEmptyLocalDirs(deletedLocalPaths: string[]): Promise<void> {
    const root = resolve(this.dataRoot)
    const starts = new Set(deletedLocalPaths.map((p) => dirname(p)))
    for (const start of starts) {
      let dir = start
      while (dir !== root && dir.startsWith(root + sep)) {
        try {
          if ((await readdir(dir)).length > 0) break
          await rmdir(dir)
        } catch {
          break // already gone or unreadable — nothing more to prune here
        }
        dir = dirname(dir)
      }
    }
  }

  async planPush(config: WebDavConfig): Promise<SyncPlanSummary> {
    const plan = await this.buildPushPlan(this.createClient(config))
    return {
      transferCount: plan.uploads.length,
      skipCount: plan.skipped,
      deleteCount: plan.remoteDeletions.length,
      deleteSample: plan.remoteDeletions.slice(0, 20).map((d) => d.relPath)
    }
  }

  async planPull(config: WebDavConfig): Promise<SyncPlanSummary> {
    const plan = await this.buildPullPlan(this.createClient(config))
    return {
      transferCount: plan.downloads.length,
      skipCount: plan.skipped,
      deleteCount: plan.localDeletions.length,
      deleteSample: plan.localDeletions.slice(0, 20).map((d) => d.relPath)
    }
  }

  /**
   * Create a timestamped backup of the data root before syncing,
   * rotating old backups (keep max 3). This mirrors anx-reader's
   * database-before-sync backup approach at the whole-data level.
   */
  private async backupBeforeSync(): Promise<void> {
    const cacheDir = join(this.dataRoot, '.sync-cache')
    await mkdir(cacheDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = join(cacheDir, `backup_${timestamp}`)
    await mkdir(backupDir, { recursive: true })

    // Copy all syncable files into the backup
    const files = await collectSyncableFiles(this.dataRoot)
    for (const file of files) {
      const destDir = dirname(join(backupDir, file.relativePath))
      await mkdir(destDir, { recursive: true })
      await copyFile(file.localPath, join(backupDir, file.relativePath))
    }

    // Rotate: keep only the 3 most recent backups
    const backups: Array<{ name: string; time: Date }> = []
    for (const entry of await readdir(cacheDir)) {
      if (!entry.startsWith('backup_')) continue
      const statResult = await stat(join(cacheDir, entry))
      backups.push({ name: entry, time: statResult.mtime })
    }
    backups.sort((a, b) => b.time.getTime() - a.time.getTime())
    for (let i = 3; i < backups.length; i++) {
      await rm(join(cacheDir, backups[i].name), { recursive: true, force: true })
    }
  }

  /**
   * Push: upload changed local files, delete previously-synced remote files
   * that no longer exist locally (plus non-syncable junk left by old
   * versions). Unchanged files are skipped.
   */
  async push(config: WebDavConfig, onProgress?: SyncProgressCallback): Promise<SyncResult> {
    await this.backupBeforeSync()
    const client = this.createClient(config)
    const plan = await this.buildPushPlan(client)
    const errors: string[] = []
    let transferred = 0
    let deleted = 0
    const total = plan.uploads.length + plan.remoteDeletions.length

    // Create each needed remote directory once, up front — previously every
    // single upload paid an extra exists+mkdir round-trip.
    const parentDirs = [
      ...new Set(plan.uploads.map((up) => dirname(up.remotePath).replace(/\\/g, '/')))
    ]
    await runPool(parentDirs, SYNC_CONCURRENCY, async (dir) => {
      await client.ensureDir(dir)
    })

    await runPool(plan.uploads, SYNC_CONCURRENCY, async (up, index) => {
      onProgress?.({ direction: 'push', current: index + 1, total, file: up.relPath })
      try {
        // Binary files stream from disk instead of being buffered whole in memory
        const content = isBinaryFile(up.relPath)
          ? createReadStream(up.localPath)
          : await readFile(up.localPath, 'utf-8')
        await client.uploadFile(up.remotePath, content)
        transferred++
      } catch (e) {
        errors.push(`${up.relPath}: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    })

    await runPool(plan.remoteDeletions, SYNC_CONCURRENCY, async (del, index) => {
      onProgress?.({
        direction: 'push',
        current: plan.uploads.length + index + 1,
        total,
        file: del.relPath
      })
      try {
        await client.deleteFile(del.remotePath)
        deleted++
      } catch (e) {
        errors.push(`${del.relPath}: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    })

    await this.pruneEmptyRemoteDirs(client, plan.remoteDeletions.map((d) => d.remotePath))

    await this.rebuildStateAfterPush(client)

    return { success: errors.length === 0, transferred, skipped: plan.skipped, deleted, errors }
  }

  /**
   * Pull: download changed remote files, delete previously-synced local
   * files that no longer exist remotely. Unchanged files are skipped.
   */
  async pull(config: WebDavConfig, onProgress?: SyncProgressCallback): Promise<SyncResult> {
    await this.backupBeforeSync()
    const client = this.createClient(config)
    const plan = await this.buildPullPlan(client)
    const errors: string[] = plan.unsafePaths.map((p) => `${p}: unsafe remote path, skipped`)
    let transferred = 0
    let deleted = 0
    const total = plan.downloads.length + plan.localDeletions.length

    await runPool(plan.downloads, SYNC_CONCURRENCY, async (down, index) => {
      onProgress?.({ direction: 'pull', current: index + 1, total, file: down.relPath })
      try {
        await mkdir(dirname(down.localPath), { recursive: true })
        if (isBinaryFile(down.relPath)) {
          // Streamed straight to disk — survives multi-hundred-MB files
          await client.downloadToFile(down.remotePath, down.localPath)
        } else {
          const content = await client.downloadFile(down.remotePath)
          await writeFile(down.localPath, content, 'utf-8')
        }
        transferred++
      } catch (e) {
        errors.push(`${down.relPath}: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    })

    await runPool(plan.localDeletions, SYNC_CONCURRENCY, async (del, index) => {
      onProgress?.({
        direction: 'pull',
        current: plan.downloads.length + index + 1,
        total,
        file: del.relPath
      })
      try {
        await rm(del.localPath, { force: true })
        deleted++
      } catch (e) {
        errors.push(`${del.relPath}: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    })

    await this.pruneEmptyLocalDirs(plan.localDeletions.map((d) => d.localPath))

    await this.rebuildStateAfterPull(client)

    return { success: errors.length === 0, transferred, skipped: plan.skipped, deleted, errors }
  }
}
