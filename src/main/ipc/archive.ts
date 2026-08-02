import { ipcMain } from 'electron'
import { readFile, writeFile, mkdir, access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  archiveDir,
  listArchive,
  restoreArchiveItem,
  purgeArchiveItem,
  type ArchiveEntry
} from '../storage/archive-store'
import { companionDir } from '../storage/app-data'
import { CompanionSchema } from '../../shared/schemas/companion'
import { IpcArchiveEntryIdInputSchema } from '../../shared/schemas/ipc'

/**
 * Restore a companion from its archived snapshot: re-insert it into
 * companions/index.json (if the id is still free), then drop the archive.
 */
async function restoreCompanion(dataRoot: string, entry: ArchiveEntry): Promise<boolean> {
  const snapPath = join(archiveDir(dataRoot), entry.id, 'companion.json')
  try {
    await access(snapPath)
  } catch {
    return false
  }
  const raw = await readFile(snapPath, 'utf-8')
  const companion = CompanionSchema.parse(JSON.parse(raw))

  const indexPath = join(companionDir(dataRoot), 'index.json')
  let existing: Array<{ id: string }> = []
  try {
    existing = JSON.parse(await readFile(indexPath, 'utf-8'))
  } catch {
    // no index yet
  }
  if (!Array.isArray(existing)) existing = []
  if (existing.some((c) => c.id === companion.id)) return false

  existing.push(companion as unknown as { id: string })
  await mkdir(companionDir(dataRoot), { recursive: true })
  await writeFile(indexPath, JSON.stringify(existing, null, 2), 'utf-8')
  await rm(join(archiveDir(dataRoot), entry.id), { recursive: true, force: true })
  await purgeArchiveItem(dataRoot, entry.id)
  return true
}

export function registerArchiveIpc(dataRoot: string): void {
  ipcMain.handle('archive:list', async () => {
    return listArchive(dataRoot)
  })

  ipcMain.handle('archive:restore', async (_event, input: unknown) => {
    const parsed = IpcArchiveEntryIdInputSchema.parse(input)
    const entries = await listArchive(dataRoot)
    const entry = entries.find((e) => e.id === parsed.entryId)
    if (!entry) return { success: false }
    if (entry.kind === 'companion') {
      return { success: await restoreCompanion(dataRoot, entry) }
    }
    return { success: await restoreArchiveItem(dataRoot, entry.id) }
  })

  ipcMain.handle('archive:purge', async (_event, input: unknown) => {
    const parsed = IpcArchiveEntryIdInputSchema.parse(input)
    return { success: await purgeArchiveItem(dataRoot, parsed.entryId) }
  })
}
