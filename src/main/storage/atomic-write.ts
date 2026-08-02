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
 */

import { writeFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export async function atomicWriteFile(
  filePath: string,
  data: string | Uint8Array,
  encoding?: BufferEncoding
): Promise<void> {
  const tmpPath = join(dirname(filePath), `.tmp-${Date.now()}-${randomBytes(4).toString('hex')}`)
  try {
    await writeFile(tmpPath, data, encoding)
    await rename(tmpPath, filePath)
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
}
