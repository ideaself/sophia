/**
 * Restore from a local backup zip (created by createBackupZip).
 *
 * Safety flow:
 * 1. Snapshot the CURRENT data to a pre-restore zip (never destroy data).
 * 2. Extract the backup into a temp dir and validate its layout.
 * 3. Swap: rename dataRoot aside, move temp into place; on failure, roll back.
 */

import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import extract from 'extract-zip'
import { createBackupZip } from './backup'

/** Top-level dirs a valid Sophia data root must contain. */
const REQUIRED_TOP_LEVEL = ['config', 'profiles']

export interface RestoreResult {
  success: boolean
  /** Path of the pre-restore snapshot (only on success). */
  preRestore?: string
  error?: string
}

export async function restoreFromBackup(dataRoot: string, zipPath: string): Promise<RestoreResult> {
  const stamp = Date.now()
  const parent = join(dataRoot, '..')

  // 1. Snapshot current data before touching anything
  const preRestore = join(parent, `Sophia-pre-restore-${stamp}.zip`)
  await createBackupZip(dataRoot, preRestore)

  // 2. Extract into a temp dir
  const tmp = join(parent, `.restore-${stamp}`)
  try {
    await mkdir(tmp, { recursive: true })
    await extract(zipPath, { dir: tmp })

    // 3. Validate the backup actually contains a data root
    const entries = new Set(await readdir(tmp))
    const missing = REQUIRED_TOP_LEVEL.filter((name) => !entries.has(name))
    if (missing.length > 0) {
      throw new Error(`备份文件缺少数据目录结构（缺少：${missing.join(', ')}），可能不是 Sophia 备份`)
    }

    // 4. Swap dataRoot ↔ temp (atomic-ish: rename is same-volume)
    const oldData = join(parent, `Sophia-data-${stamp}`)
    await rename(dataRoot, oldData)
    try {
      await rename(tmp, dataRoot)
    } catch (err) {
      // Roll back
      await rename(oldData, dataRoot).catch(() => {})
      throw err
    }
    await rm(oldData, { recursive: true, force: true }).catch(() => {})

    return { success: true, preRestore }
  } catch (err) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
