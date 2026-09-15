/**
 * Atomic file writes for application data.
 *
 * `fs.writeFile` truncates the target in place — a crash or power loss mid-write
 * leaves a half-written (corrupted) file. Writing to a sibling temp file first
 * and renaming into place makes each write all-or-nothing: the old content
 * survives until the new content is fully on disk.
 *
 * Rename is atomic on the same volume; the temp file lives next to the target
 * so they always share a volume.
 *
 * Two durability details beyond the naive write+rename:
 * - the temp file is fsync'ed before the rename (otherwise a power loss can
 *   leave a zero-length target: the rename metadata hits disk before the data),
 * - the rename is retried briefly on Windows, where antivirus / sync clients
 *   can transiently hold the target open (EPERM/EBUSY/EACCES).
 */

import { open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

const RENAME_RETRY_DELAYS_MS = [20, 60, 150]

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
      if (!retryable || attempt >= RENAME_RETRY_DELAYS_MS.length) throw err
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]))
    }
  }
}

export async function atomicWriteFile(
  filePath: string,
  data: string | Uint8Array,
  encoding?: BufferEncoding
): Promise<void> {
  const tmpPath = join(dirname(filePath), `.tmp-${Date.now()}-${randomBytes(4).toString('hex')}`)
  try {
    const handle = await open(tmpPath, 'w')
    try {
      await handle.writeFile(data, encoding)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(tmpPath, filePath)
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
}
