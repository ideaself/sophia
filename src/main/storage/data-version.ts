import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-write'
import { isNotFoundError, warnReadFailure } from './fs-errors'

/**
 * Schema generation of the on-disk data layout (LocalData/).
 *
 * Bump this whenever a change would make an older app misread data written
 * by a newer one (renamed/retired files, changed JSON shapes, …), and add a
 * matching entry to MIGRATIONS so existing data roots upgrade on startup.
 *
 * 1 — initial stamped version (layout unchanged since v0.1.0).
 */
export const DATA_VERSION = 1

export const DATA_VERSION_FILE = 'data-version.json'

/** Upgrades data from version n to n+1. Must be idempotent. */
export type DataMigration = (dataRoot: string) => Promise<void>

/**
 * Registry of data migrations. A missing entry is a no-op step, so a version
 * bump without structural changes only needs DATA_VERSION changed.
 */
export const MIGRATIONS: Record<number, DataMigration> = {
  0: async () => {
    // 0 → 1: layout unchanged; stamping the version is the whole migration.
  }
}

export interface DataVersionState {
  /** Version after migrating (equals DATA_VERSION unless downgraded). */
  version: number
  /** Version the data was at before migrating, when an upgrade actually ran. */
  migratedFrom: number | null
  /** Data was written by a newer app; it was left untouched. */
  downgraded: boolean
}

export interface MigrateOptions {
  migrations?: Record<number, DataMigration>
  /** Target version; defaults to DATA_VERSION (overridable for tests). */
  targetVersion?: number
}

/**
 * Read the stamped data version. Returns 0 for a missing file (data root from
 * v0.1.x, before versioning existed) and for unrecognizable content — both
 * mean "older than the version this app knows about".
 */
export async function readDataVersion(dataRoot: string): Promise<number> {
  return (await readVersionState(dataRoot)).version
}

function parseVersion(raw: string): number {
  const parsed = JSON.parse(raw) as { version?: unknown }
  if (typeof parsed.version !== 'number' || !Number.isFinite(parsed.version)) {
    throw new TypeError('data-version.json: missing numeric "version"')
  }
  return parsed.version
}

async function readVersionState(dataRoot: string): Promise<{ version: number; existed: boolean }> {
  try {
    const raw = await readFile(join(dataRoot, DATA_VERSION_FILE), 'utf-8')
    try {
      return { version: parseVersion(raw), existed: true }
    } catch (err) {
      warnReadFailure(`${DATA_VERSION_FILE} (unrecognized shape)`, err)
      return { version: 0, existed: true }
    }
  } catch (err) {
    if (!isNotFoundError(err)) warnReadFailure(DATA_VERSION_FILE, err)
    return { version: 0, existed: !isNotFoundError(err) }
  }
}

/**
 * Bring a data root up to the app's data version.
 *
 * Runs registered migrations in order, then stamps the result. Data written by
 * a newer app is never touched (only reported) so a downgrade cannot corrupt
 * it — the caller decides how loudly to surface that.
 */
export async function migrateDataRoot(
  dataRoot: string,
  options: MigrateOptions = {}
): Promise<DataVersionState> {
  const { migrations = MIGRATIONS, targetVersion = DATA_VERSION } = options
  const { version: current, existed } = await readVersionState(dataRoot)

  if (current > targetVersion) {
    console.warn(
      `[data] LocalData is version ${current}, newer than this app (${targetVersion}); leaving it untouched`
    )
    return { version: current, migratedFrom: null, downgraded: true }
  }

  for (let version = current; version < targetVersion; version++) {
    await migrations[version]?.(dataRoot)
  }

  if (!existed || current < targetVersion) {
    await atomicWriteFile(
      join(dataRoot, DATA_VERSION_FILE),
      JSON.stringify({ version: targetVersion, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    )
    if (existed) {
      console.log(`[data] migrated LocalData v${current} -> v${targetVersion}`)
    }
  }

  return {
    version: targetVersion,
    migratedFrom: existed && current < targetVersion ? current : null,
    downgraded: false
  }
}
