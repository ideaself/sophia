import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const EXCLUDE_PATTERNS = [
  /[/\\]config[/\\][^/\\]+\.key\.enc$/,
  /[/\\]companions/
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
