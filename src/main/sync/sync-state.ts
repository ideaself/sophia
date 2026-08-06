import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isNotFoundError, warnReadFailure } from '../storage/fs-errors'
import { atomicWriteFile } from '../storage/atomic-write'

/**
 * Per-device record of what was synced and when. This is what lets mirror
 * sync delete ONLY files that were previously synced — a file that never
 * went through sync (e.g. a locally created, never-pushed companion) is
 * never touched by deletion logic on either side.
 *
 * Timestamps are only ever compared like-for-like: local mtime against a
 * previously recorded local mtime, remote lastmod against a previously
 * recorded remote lastmod. Never across machines, so clock skew is irrelevant.
 */
export interface SyncStateEntry {
  localSize: number | null
  localMtimeMs: number | null
  remoteSize: number | null
  remoteLastmod: string | null
}

export interface SyncState {
  version: 1
  /** Key: path relative to dataRoot, forward slashes */
  files: Record<string, SyncStateEntry>
}

export const SYNC_STATE_FILE = 'sync-state.json'

/** Returns null when there is no usable state (first run or corruption). */
export async function loadSyncState(dataRoot: string): Promise<SyncState | null> {
  try {
    const raw = await readFile(join(dataRoot, SYNC_STATE_FILE), 'utf-8')
    const parsed = JSON.parse(raw) as SyncState
    if (parsed.version !== 1 || typeof parsed.files !== 'object' || parsed.files === null) {
      warnReadFailure('sync-state.json (unrecognized shape)', new Error('version/files mismatch'))
      return null
    }
    return parsed
  } catch (err) {
    if (!isNotFoundError(err)) warnReadFailure('sync-state.json', err)
    return null
  }
}

export async function saveSyncState(dataRoot: string, state: SyncState): Promise<void> {
  await atomicWriteFile(join(dataRoot, SYNC_STATE_FILE), JSON.stringify(state, null, 2), 'utf-8')
}

export function emptySyncState(): SyncState {
  return { version: 1, files: {} }
}
