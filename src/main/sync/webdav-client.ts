import { createClient, type WebDAVClient } from 'webdav'
import type { FileStat } from 'webdav'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { runPool } from './async-pool'

/** Concurrent PROPFIND listings during the recursive remote walk. */
const WALK_CONCURRENCY = 4

export interface WebDavConfig {
  url: string
  username: string
  password: string
}

export interface WebDavFile {
  path: string
  isDir: boolean
}

export interface WebDavRemoteFile {
  path: string
  size: number
  lastmod: string
}

/**
 * Rejects with a descriptive error if `promise` does not settle within `ms`.
 * The webdav v5 client exposes no request timeout, so without this a hung
 * connection would await forever and the UI would show "Pulling..." endlessly.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timed out after ${Math.round(ms / 1000)}s: ${label}`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/** Per-request timeout for sync operations (large PDFs on slow servers need headroom). */
const REQUEST_TIMEOUT_MS = 120_000

/** Idle limit for streaming downloads: fails only when NO bytes arrive for this long. */
const STREAM_IDLE_TIMEOUT_MS = 60_000

/** Total limit for streamed uploads (no byte-level progress signal available). */
const STREAM_UPLOAD_TIMEOUT_MS = 600_000

/**
 * Pipes a readable stream to a local file, failing only if the stream goes
 * silent for `idleMs`. Unlike a total-duration timeout this lets large files
 * take as long as they need while still surfacing genuinely stalled transfers.
 */
export function pipeToFileWithIdleTimeout(
  readable: Readable,
  localPath: string,
  idleMs: number,
  label: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const writable = createWriteStream(localPath)
    let timer = setTimeout(onIdle, idleMs)

    function resetTimer(): void {
      clearTimeout(timer)
      timer = setTimeout(onIdle, idleMs)
    }

    function onIdle(): void {
      clearTimeout(timer)
      readable.destroy()
      writable.destroy()
      reject(new Error(`Download idle for ${Math.round(idleMs / 1000)}s: ${label}`))
    }

    readable.on('data', resetTimer)
    readable.on('error', (err) => {
      clearTimeout(timer)
      writable.destroy()
      reject(err)
    })
    writable.on('error', (err) => {
      clearTimeout(timer)
      readable.destroy()
      reject(err)
    })
    writable.on('finish', () => {
      clearTimeout(timer)
      resolve()
    })

    readable.pipe(writable)
  })
}

export class SyncWebDavClient {
  private client: WebDAVClient

  constructor(config: WebDavConfig) {
    // Note: no remoteBasePath here — in webdav v5 it is NOT prepended to
    // request paths, it only rewrites PROPFIND response hrefs (which produced
    // bogus relative filenames). Callers prefix remote paths explicitly.
    this.client = createClient(config.url, {
      username: config.username,
      password: config.password
    })
  }

  async test(): Promise<{ success: boolean; message?: string }> {
    try {
      await withTimeout(this.client.getDirectoryContents('/'), REQUEST_TIMEOUT_MS, 'PROPFIND /')
      return { success: true, message: 'Connected successfully' }
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Connection failed'
      }
    }
  }

  async uploadFile(remotePath: string, content: string | Buffer | Readable): Promise<void> {
    const timeout = content instanceof Readable ? STREAM_UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS
    await withTimeout(
      this.client.putFileContents(remotePath, content, { overwrite: true }),
      timeout,
      `PUT ${remotePath}`
    )
  }

  async downloadFile(remotePath: string): Promise<string> {
    const data = await withTimeout(
      this.client.getFileContents(remotePath, { format: 'text' }),
      REQUEST_TIMEOUT_MS,
      `GET ${remotePath}`
    )
    if (typeof data === 'string') return data
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
    return buf.toString('utf-8')
  }

  async downloadFileBuffer(remotePath: string): Promise<Buffer> {
    const data = await withTimeout(
      this.client.getFileContents(remotePath, { format: 'binary' }),
      REQUEST_TIMEOUT_MS,
      `GET ${remotePath}`
    )
    return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
  }

  /**
   * Streams a remote file straight to disk. Large binaries (100MB+ PDFs)
   * must not be buffered in memory or bound by a total-duration timeout.
   */
  async downloadToFile(remotePath: string, localPath: string): Promise<void> {
    const stream = this.client.createReadStream(remotePath)
    await pipeToFileWithIdleTimeout(stream, localPath, STREAM_IDLE_TIMEOUT_MS, `GET ${remotePath}`)
  }

  async listFiles(remoteDir: string): Promise<WebDavFile[]> {
    try {
      const entries = await withTimeout(
        this.client.getDirectoryContents(remoteDir),
        REQUEST_TIMEOUT_MS,
        `PROPFIND ${remoteDir}`
      )
      const results: WebDavFile[] = []
      for (const entry of entries) {
        if (entry.basename === '') continue // skip self
        results.push({
          path: entry.filename,
          isDir: entry.type === 'directory'
        })
      }
      return results
    } catch {
      return []
    }
  }

  async ensureDir(remoteDir: string): Promise<void> {
    try {
      const exists = await this.client.exists(remoteDir)
      if (!exists) {
        await this.client.createDirectory(remoteDir, { recursive: true })
      }
    } catch {
      // Best effort — some servers auto-create dirs on put
    }
  }

  /**
   * Recursively list all files under a remote directory.
   */
  async listAllFiles(remoteDir: string): Promise<string[]> {
    const files: string[] = []
    await this.walkRemote(remoteDir, files)
    return files
  }

  /**
   * Recursively list all files with the metadata mirror sync needs for
   * change detection (size + server-side lastmod).
   */
  async listAllFilesDetailed(remoteDir: string): Promise<WebDavRemoteFile[]> {
    const files: WebDavRemoteFile[] = []
    await this.walkRemoteDetailed(remoteDir, files)
    return files
  }

  async deleteFile(remotePath: string): Promise<void> {
    await withTimeout(
      this.client.deleteFile(remotePath),
      REQUEST_TIMEOUT_MS,
      `DELETE ${remotePath}`
    )
  }

  private async walkRemote(dir: string, files: string[]): Promise<void> {
    try {
      const entries = await withTimeout(
        this.client.getDirectoryContents(dir),
        REQUEST_TIMEOUT_MS,
        `PROPFIND ${dir}`
      )
      for (const entry of entries) {
        if (entry.basename === '') continue
        if (entry.type === 'directory') {
          await this.walkRemote(entry.filename, files)
        } else {
          files.push(entry.filename)
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  private async walkRemoteDetailed(dir: string, files: WebDavRemoteFile[]): Promise<void> {
    try {
      const entries = await withTimeout(
        this.client.getDirectoryContents(dir),
        REQUEST_TIMEOUT_MS,
        `PROPFIND ${dir}`
      )
      const subdirs: string[] = []
      for (const entry of entries) {
        if (entry.basename === '') continue
        if (entry.type === 'directory') {
          subdirs.push(entry.filename)
        } else {
          files.push({ path: entry.filename, size: entry.size, lastmod: entry.lastmod })
        }
      }
      // List subdirectories concurrently — sequential PROPFIND per directory
      // dominated sync time on deep data layouts.
      await runPool(subdirs, WALK_CONCURRENCY, async (sub) => {
        await this.walkRemoteDetailed(sub, files)
      })
    } catch {
      // Directory doesn't exist yet
    }
  }
}
