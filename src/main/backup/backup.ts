/**
 * Local full-data backup: pack the app data directory into a zip file.
 */

import { ZipArchive } from 'archiver'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface BackupResult {
  fileCount: number
}

export async function createBackupZip(
  dataRoot: string,
  destPath: string
): Promise<BackupResult> {
  await mkdir(dirname(destPath), { recursive: true })

  const output = createWriteStream(destPath)
  const archive = new ZipArchive({ zlib: { level: 9 } })

  let fileCount = 0
  const done = new Promise<BackupResult>((resolve, reject) => {
    output.on('close', () => resolve({ fileCount }))
    output.on('error', reject)
    archive.on('error', reject)
    archive.on('entry', (entry: { type: string }) => {
      if (entry.type === 'file') fileCount++
    })
  })

  archive.pipe(output)
  // `false` = add the directory contents at the zip root (no wrapper folder)
  archive.directory(dataRoot, false)
  await archive.finalize()
  return done
}
