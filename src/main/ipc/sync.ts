import { ipcMain } from 'electron'
import { SyncManager } from '../sync/sync-manager'

export interface WebDavConfigInput {
  url: string
  username: string
  password: string
}

export function registerSyncIpc(dataRoot: string): void {
  const manager = new SyncManager(dataRoot)

  ipcMain.handle('sync:test', async (_event, input: unknown) => {
    const config = input as WebDavConfigInput
    return manager.test(config)
  })

  ipcMain.handle('sync:push', async (_event, input: unknown) => {
    const config = input as WebDavConfigInput
    const result = await manager.push(config)
    if (result.success) {
      return { ...result, timestamp: new Date().toISOString() }
    }
    return result
  })

  ipcMain.handle('sync:pull', async (_event, input: unknown) => {
    const config = input as WebDavConfigInput
    const result = await manager.pull(config)
    if (result.success) {
      return { ...result, timestamp: new Date().toISOString() }
    }
    return result
  })
}
