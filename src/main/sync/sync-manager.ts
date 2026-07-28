import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { dirname, join, extname } from 'node:path'
import { SyncWebDavClient, type WebDavConfig, type WebDavRemoteFile } from './webdav-client'
import { collectSyncableFiles, type SyncableFile } from './file-walker'
import {
  loadSyncState,
  saveSyncState,
  emptySyncState,
  type SyncState
} from './sync-state'

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
const BINARY_EXTENSIONS = new Set(['.pdf'])

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
  constructor(private readonly dataRoot: string) {}

  private createClient(config: WebDavConfig): SyncWebDavClient {
    return new SyncWebDavClient(config)
  }

  async test(config: WebDavConfig): Promise<{ success: boolean; message?: string }> {
    const client = this.createClient(config)
    return client.test()
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
   * listing. Seeding marks every remote file as "previously synced" so the
   * very first push can clean up junk left by the old full-upload sync,
   * while local files (localSize null ≠ actual stat) are all (re)uploaded.
   */
  private async loadStateForPush(remoteList: WebDavRemoteFile[]): Promise<SyncState> {
    const state = await loadSyncState(this.dataRoot)
    if (state) return state
    const seeded = emptySyncState()
    for (const f of remoteList) {
      seeded.files[stripPrefix(f.path)] = {
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

    // Mirror deletion: only files recorded as previously synced are eligible;
    // remote files we know nothing about are left alone.
    const remoteDeletions: FileTransfer[] = []
    for (const [rel, remote] of remoteByRel) {
      if (localRelSet.has(rel)) continue
      if (!(rel in state.files)) continue
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
   * Push: upload changed local files, delete previously-synced remote files
   * that no longer exist locally. Unchanged files are skipped.
   */
  async push(config: WebDavConfig, onProgress?: SyncProgressCallback): Promise<SyncResult> {
    const client = this.createClient(config)
    const plan = await this.buildPushPlan(client)
    const errors: string[] = []
    let transferred = 0
    let deleted = 0
    const total = plan.uploads.length + plan.remoteDeletions.length
    let step = 0

    for (const up of plan.uploads) {
      step++
      onProgress?.({ direction: 'push', current: step, total, file: up.relPath })
      try {
        // Binary files stream from disk instead of being buffered whole in memory
        const content = isBinaryFile(up.relPath)
          ? createReadStream(up.localPath)
          : await readFile(up.localPath, 'utf-8')
        // Ensure parent directory exists
        const parentDir = dirname(up.remotePath).replace(/\\/g, '/')
        await client.ensureDir(parentDir)
        await client.uploadFile(up.remotePath, content)
        transferred++
      } catch (e) {
        errors.push(`${up.relPath}: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    }

    for (const del of plan.remoteDeletions) {
      step++
      onProgress?.({ direction: 'push', current: step, total, file: del.relPath })
      try {
        await client.deleteFile(del.remotePath)
        deleted++
      } catch (e) {
        errors.push(`${del.relPath}: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    }

    await this.rebuildStateAfterPush(client)

    return { success: errors.length === 0, transferred, skipped: plan.skipped, deleted, errors }
  }

  /**
   * Pull: download changed remote files, delete previously-synced local
   * files that no longer exist remotely. Unchanged files are skipped.
   */
  async pull(config: WebDavConfig, onProgress?: SyncProgressCallback): Promise<SyncResult> {
    const client = this.createClient(config)
    const plan = await this.buildPullPlan(client)
    const errors: string[] = plan.unsafePaths.map((p) => `${p}: unsafe remote path, skipped`)
    let transferred = 0
    let deleted = 0
    const total = plan.downloads.length + plan.localDeletions.length
    let step = 0

    for (const down of plan.downloads) {
      step++
      onProgress?.({ direction: 'pull', current: step, total, file: down.relPath })
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
    }

    for (const del of plan.localDeletions) {
      step++
      onProgress?.({ direction: 'pull', current: step, total, file: del.relPath })
      try {
        await rm(del.localPath, { force: true })
        deleted++
      } catch (e) {
        errors.push(`${del.relPath}: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    }

    await this.rebuildStateAfterPull(client)

    return { success: errors.length === 0, transferred, skipped: plan.skipped, deleted, errors }
  }
}
