/**
 * Safe zip extraction for backup restore.
 *
 * Replaces `extract-zip`, which has an unfixed advisory for symlink entries:
 * a malicious "backup" containing a symlink plus a file entry could write
 * outside the destination directory (GHSA-jmr9-qjv8-65gv).
 *
 * This extractor never materializes symlinks or any non-file entry — every
 * entry is written as a plain file — and additionally:
 * - rejects entries whose resolved path escapes the destination (zip slip),
 * - enforces a total uncompressed-size cap (zip bomb).
 */

import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as unzipper from 'unzipper'

/** Backups can legitimately be large (textbooks); 4 GiB is the hard ceiling. */
const MAX_UNCOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024

export async function extractZipSafely(zipPath: string, destDir: string): Promise<void> {
  const directory = await unzipper.Open.file(zipPath)
  const root = resolve(destDir)
  let totalUncompressed = 0

  for (const entry of directory.files) {
    // Zip entry names may use backslashes; normalize before resolving.
    const normalized = entry.path.replace(/\\/g, '/').replace(/\/+$/, '')
    /* v8 ignore next -- @preserve */
    if (!normalized) continue
    const outPath = resolve(root, normalized)
    if (outPath !== root && !outPath.startsWith(root + sep)) {
      throw new Error(`备份包含非法路径条目，已中止：${entry.path}`)
    }

    // Directory entries (including empty dirs) are recreated as real
    // directories. Nothing else is ever materialized: a symlink entry is
    // written as a plain file, keeping the archive from escaping the dest.
    if (entry.type === 'Directory') {
      await mkdir(outPath, { recursive: true })
      continue
    }

    totalUncompressed += entry.uncompressedSize
    /* v8 ignore next -- @preserve */
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      /* v8 ignore next -- @preserve */
      throw new Error('备份解压后体积超出上限，已中止（疑似异常压缩包）')
    }

    await mkdir(dirname(outPath), { recursive: true })
    await pipeline(entry.stream(), createWriteStream(outPath))
  }
}
