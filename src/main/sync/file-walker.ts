import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const EXCLUDE_PATTERNS = [
  // Encrypted secrets (API keys, WebDAV password) never leave this machine.
  // Note: relPath has no leading separator, so the anchor must allow
  // string start; and not all secret files end in ".key.enc".
  /(^|[/\\])config[/\\][^/\\]+\.enc$/,
  // Local sync bookkeeping is per-device and must not sync.
  /(^|[/\\])sync-state\.json$/
]

export interface SyncableFile {
  localPath: string
  relativePath: string
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
      if (EXCLUDE_PATTERNS.some((p) => p.test(relPath))) continue
      await walkDir(fullPath, dataRoot, files)
    } else if (entry.isFile()) {
      if (EXCLUDE_PATTERNS.some((p) => p.test(relPath))) continue
      files.push({ localPath: fullPath, relativePath: relPath })
    }
  }
}
