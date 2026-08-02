/**
 * Archive store — a lightweight recycle bin.
 *
 * Deleting important data (conversations, textbooks, companions) first moves
 * the item into `{dataRoot}/archive/{stamp}_{kind}_{id}` and records the
 * original location in `manifest.json`, so it can be restored later
 * (mirrors the original's 4.0.1 "删除前会先留下归档").
 */

import { join, dirname, relative } from 'node:path'
import { readFile, writeFile, mkdir, rm, rename, access } from 'node:fs/promises'

export type ArchiveKind = 'conversation' | 'textbook' | 'companion' | 'other'

export interface ArchiveEntry {
  /** Archive dir name — also the manifest key. */
  id: string
  kind: ArchiveKind
  label: string
  movedAt: string
  /** Path relative to dataRoot where the item originally lived. */
  originalPath: string
  /** For companions (stored inside index.json): a snapshot of the record. */
  snapshot?: unknown
}

export function archiveDir(dataRoot: string): string {
  return join(dataRoot, 'archive')
}

function archiveManifestPath(dataRoot: string): string {
  return join(archiveDir(dataRoot), 'manifest.json')
}

async function readManifest(dataRoot: string): Promise<Record<string, ArchiveEntry>> {
  try {
    const raw = await readFile(archiveManifestPath(dataRoot), 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ArchiveEntry>) : {}
  } catch {
    return {}
  }
}

async function writeManifest(dataRoot: string, manifest: Record<string, ArchiveEntry>): Promise<void> {
  await mkdir(archiveDir(dataRoot), { recursive: true })
  await writeFile(archiveManifestPath(dataRoot), JSON.stringify(manifest, null, 2), 'utf-8')
}

function newEntryId(kind: ArchiveKind, id: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
  return `${stamp}_${kind}_${safeId}`
}

/**
 * Move a file or directory into the archive. Returns the entry id,
 * or null when the source doesn't exist (nothing to archive).
 */
export async function archiveItem(
  dataRoot: string,
  kind: ArchiveKind,
  id: string,
  sourcePath: string,
  label: string
): Promise<string | null> {
  try {
    await access(sourcePath)
  } catch {
    return null
  }

  const entryId = newEntryId(kind, id)
  const target = join(archiveDir(dataRoot), entryId)
  await mkdir(archiveDir(dataRoot), { recursive: true })
  await rename(sourcePath, target)

  const manifest = await readManifest(dataRoot)
  manifest[entryId] = {
    id: entryId,
    kind,
    label,
    movedAt: new Date().toISOString(),
    originalPath: relative(dataRoot, sourcePath)
  }
  await writeManifest(dataRoot, manifest)
  return entryId
}

/**
 * Archive a companion by writing a JSON snapshot into the archive
 * (companions live inside index.json, so there's no directory to move).
 */
export async function archiveCompanion(
  dataRoot: string,
  companionId: string,
  label: string,
  snapshot: unknown
): Promise<string> {
  const entryId = newEntryId('companion', companionId)
  const target = join(archiveDir(dataRoot), entryId, 'companion.json')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(snapshot, null, 2), 'utf-8')

  const manifest = await readManifest(dataRoot)
  manifest[entryId] = {
    id: entryId,
    kind: 'companion',
    label,
    movedAt: new Date().toISOString(),
    originalPath: '', // companions have no standalone original path
    snapshot
  }
  await writeManifest(dataRoot, manifest)
  return entryId
}

export async function listArchive(dataRoot: string): Promise<ArchiveEntry[]> {
  const manifest = await readManifest(dataRoot)
  return Object.values(manifest).sort((a, b) => b.movedAt.localeCompare(a.movedAt))
}

/** Move an archived item back to where it lived before. */
export async function restoreArchiveItem(dataRoot: string, entryId: string): Promise<boolean> {
  const manifest = await readManifest(dataRoot)
  const entry = manifest[entryId]
  if (!entry) return false

  if (entry.kind === 'companion') {
    return false
  }

  const src = join(archiveDir(dataRoot), entry.id)
  const dest = join(dataRoot, entry.originalPath)
  try {
    await access(src)
  } catch {
    return false
  }
  await mkdir(dirname(dest), { recursive: true })
  await rename(src, dest)
  delete manifest[entryId]
  await writeManifest(dataRoot, manifest)
  return true
}

/** Permanently delete an archived item. */
export async function purgeArchiveItem(dataRoot: string, entryId: string): Promise<boolean> {
  const manifest = await readManifest(dataRoot)
  const entry = manifest[entryId]
  if (!entry) return false
  const src = join(archiveDir(dataRoot), entry.id)
  await rm(src, { recursive: true, force: true })
  delete manifest[entryId]
  await writeManifest(dataRoot, manifest)
  return true
}
