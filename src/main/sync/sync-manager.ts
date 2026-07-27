import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SyncWebDavClient, type WebDavConfig } from './webdav-client'
import { collectSyncableFiles } from './file-walker'

const REMOTE_PREFIX = '/sophia'

export interface SyncResult {
  success: boolean
  count: number
  errors: string[]
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
  async push(config: WebDavConfig): Promise<SyncResult> {
    const client = this.createClient(config)
    const files = await collectSyncableFiles(this.dataRoot)
    const errors: string[] = []
    let count = 0

    for (const file of files) {
      const remotePath = '/' + file.relativePath
      try {
        const content = await readFile(file.localPath, 'utf-8')
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
  async pull(config: WebDavConfig): Promise<SyncResult> {
    const client = this.createClient(config)
    const errors: string[] = []
    let count = 0

    // List all remote files
    const remoteFiles = await client.listAllFiles(REMOTE_PREFIX)

    for (const remotePath of remoteFiles) {
      // Strip the REMOTE_PREFIX to get the relative path
      const relPath = remotePath.startsWith(REMOTE_PREFIX + '/')
        ? remotePath.slice(REMOTE_PREFIX.length + 1)
        : remotePath

      const localPath = join(this.dataRoot, relPath)

      try {
        const content = await client.downloadFile(remotePath)
        // Ensure local directory exists
        await mkdir(dirname(localPath), { recursive: true })
        await writeFile(localPath, content, 'utf-8')
        count++
      } catch (e) {
        errors.push(`${relPath}: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    }

    return { success: errors.length === 0, count, errors }
  }
}
