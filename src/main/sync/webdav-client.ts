import { createClient, type WebDAVClient } from 'webdav'
import type { FileStat } from 'webdav'

export interface WebDavConfig {
  url: string
  username: string
  password: string
}

export interface WebDavFile {
  path: string
  isDir: boolean
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

  async uploadFile(remotePath: string, content: string | Buffer): Promise<void> {
    await withTimeout(
      this.client.putFileContents(remotePath, content, { overwrite: true }),
      REQUEST_TIMEOUT_MS,
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
}
