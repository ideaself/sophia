import { ipcMain } from 'electron'
import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { CompanionSchema } from '../../shared/schemas/companion'
import { companionDir } from '../storage/app-data'

export function registerCompanionIpc(dataRoot: string): void {
  ipcMain.handle('companion:list', async () => {
    const indexPath = join(companionDir(dataRoot), 'index.json')
    try {
      await access(indexPath)
      const content = await readFile(indexPath, 'utf-8')
      const parsed = JSON.parse(content)
      return CompanionSchema.array().parse(parsed)
    } catch {
      return []
    }
  })

  ipcMain.handle('companion:get', async (_event, input: unknown) => {
    const { companionId } = input as { companionId: string }
    const indexPath = join(companionDir(dataRoot), 'index.json')
    try {
      const content = await readFile(indexPath, 'utf-8')
      const companions = CompanionSchema.array().parse(JSON.parse(content))
      return companions.find((c) => c.id === companionId) ?? null
    } catch {
      return null
    }
  })
}
