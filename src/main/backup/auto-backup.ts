/**
 * Automatic periodic backups: on app start, if the newest auto backup is
 * older than AUTO_BACKUP_INTERVAL_DAYS, create a fresh zip and prune old
 * ones down to AUTO_BACKUP_KEEP. Runs in the background — never blocks
 * startup.
 */

import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createBackupZip } from './backup'

const AUTO_BACKUP_INTERVAL_MS = 7 * 24 * 3600 * 1000
const AUTO_BACKUP_KEEP = 5

/** Backups live OUTSIDE dataRoot so the zip never contains itself. */
export function backupsDir(dataRoot: string): string {
  return join(dataRoot, '..', 'SophiaLocal-backups')
}

export async function maybeAutoBackup(dataRoot: string): Promise<void> {
  try {
    const dir = backupsDir(dataRoot)
    await mkdir(dir, { recursive: true })

    const files = (await readdir(dir)).filter((f) => f.startsWith('auto-') && f.endsWith('.zip'))
    let newestMs = 0
    for (const f of files) {
      try {
        newestMs = Math.max(newestMs, (await stat(join(dir, f))).mtimeMs)
      } catch {
        // unreadable file — skip
      }
    }
    if (Date.now() - newestMs < AUTO_BACKUP_INTERVAL_MS) return

    const stamp = new Date().toISOString().slice(0, 10)
    await createBackupZip(dataRoot, join(dir, `auto-${stamp}.zip`))

    // Prune: keep 4 newest old backups + the one just created = 5 total
    const timed = (
      await Promise.all(
        files.map(async (f) => {
          try {
            return { f, t: (await stat(join(dir, f))).mtimeMs }
          } catch {
            return null
          }
        })
      )
    ).filter((x): x is { f: string; t: number } => x !== null)
    timed.sort((a, b) => b.t - a.t)
    for (const old of timed.slice(AUTO_BACKUP_KEEP - 1)) {
      await unlink(join(dir, old.f)).catch(() => {})
    }
  } catch (err) {
    // Best-effort: never crash startup because of a backup failure
    console.error('Auto backup failed:', err)
  }
}
