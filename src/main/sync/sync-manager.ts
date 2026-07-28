import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, extname } from 'node:path'
import { SyncWebDavClient, type WebDavConfig } from './webdav-client'
import { collectSyncableFiles } from './file-walker'

const REMOTE_PREFIX = '/sophia'

export interface SyncResult {
  success: boolean
  count: number
  errors: string[]
}

export interface SyncProgress {
  direction: 'push' | 'pull'
  /** 1-based index of the file currently being transferred */
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

export class SyncManager {
  constructor(private readonly dataRoot: string) {}

  private createClient(config: WebDavConfig): SyncWebDavClient {
    return new SyncWebDavClient(config)
  }

  async test(config: WebDavConfig): Promise<{ success: boolean; message?: string }> {
    const client = this.createClient(config)
    return client.test()
  }

  /**
   * Push: upload all local syncable files to the WebDAV server.
   */
  async push(config: WebDavConfig, onProgress?: SyncProgressCallback): Promise<SyncResult> {
    const client = this.createClient(config)
    const files = await collectSyncableFiles(this.dataRoot)
    const errors: string[] = []
    let count = 0

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      onProgress?.({ direction: 'push', current: i + 1, total: files.length, file: file.relativePath })
      const remotePath = REMOTE_PREFIX + '/' + file.relativePath
      try {
        const content = isBinaryFile(file.relativePath)
          ? await readFile(file.localPath)
          : await readFile(file.localPath, 'utf-8')
        // Ensure parent directory exists
        const parentDir = dirname(remotePath).replace(/\\/g, '/')
        await client.ensureDir(parentDir)
        await client.uploadFile(remotePath, content)
        count++
      } catch (e) {
        errors.push(`${file.relativePath}: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    }

    return { success: errors.length === 0, count, errors }
  }

  /**
   * Pull: download all remote files to the local dataRoot.
   */
  async pull(config: WebDavConfig, onProgress?: SyncProgressCallback): Promise<SyncResult> {
    const client = this.createClient(config)
    const errors: string[] = []
    let count = 0

    // List all remote files
    const remoteFiles = await client.listAllFiles(REMOTE_PREFIX)

    for (let i = 0; i < remoteFiles.length; i++) {
      const remotePath = remoteFiles[i]
      // Strip the REMOTE_PREFIX to get the relative path
      const relPath = remotePath.startsWith(REMOTE_PREFIX + '/')
        ? remotePath.slice(REMOTE_PREFIX.length + 1)
        : remotePath

      // Guard against hostile or malformed server responses writing outside dataRoot
      if (!isSafeRelativePath(relPath)) {
        errors.push(`${relPath}: unsafe remote path, skipped`)
        continue
      }

      const localPath = join(this.dataRoot, relPath)

      onProgress?.({ direction: 'pull', current: i + 1, total: remoteFiles.length, file: relPath })

      try {
        const content = isBinaryFile(relPath)
          ? await client.downloadFileBuffer(remotePath)
          : await client.downloadFile(remotePath)
        // Ensure local directory exists
        await mkdir(dirname(localPath), { recursive: true })
        await writeFile(localPath, content)
        count++
      } catch (e) {
        errors.push(`${relPath}: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    }

    return { success: errors.length === 0, count, errors }
  }
}
