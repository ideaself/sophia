import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const EXCLUDE_PATTERNS = [
  // Encrypted secrets (API keys, WebDAV password) never leave this machine.
  // Note: relPath has no leading separator, so the anchor must allow
  // string start; and not all secret files end in ".key.enc".
  /(^|[/\\])config[/\\][^/\\]+\.enc$/,
  // Local sync bookkeeping is per-device and must not sync.
  /(^|[/\\])sync-state\.json$/,
  // Local sync cache (pre-sync backups, etc.) is per-device.
  /(^|[/\\])\.sync-cache[/\\]/,
  // Remote trash (deleted files parked on the server before removal) is
  // invisible to sync: never downloaded, never re-deleted as junk.
  /(^|[/\\])\.trash[/\\]/
]

export interface SyncableFile {
  localPath: string
  relativePath: string
}

/**
 * The single definition of the sync set, used by BOTH directions:
 * push never uploads these paths, pull never downloads them, and any remote
 * file failing this test is junk (e.g. left by the old full-upload sync)
 * that push garbage-collects from the server.
 */
export function isSyncableRelPath(relPath: string): boolean {
  return !EXCLUDE_PATTERNS.some((p) => p.test(relPath))
}

export async function collectSyncableFiles(dataRoot: string): Promise<SyncableFile[]> {
  const files: SyncableFile[] = []
  await walkDir(dataRoot, dataRoot, files)
  return files
}

async function walkDir(
  dir: string,
  dataRoot: string,
  files: SyncableFile[]
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const relPath = relative(dataRoot, fullPath).replace(/\\/g, '/')

    if (entry.isDirectory()) {
      if (!isSyncableRelPath(relPath)) continue
      await walkDir(fullPath, dataRoot, files)
    } else if (entry.isFile()) {
      if (!isSyncableRelPath(relPath)) continue
      files.push({ localPath: fullPath, relativePath: relPath })
    }
  }
}
