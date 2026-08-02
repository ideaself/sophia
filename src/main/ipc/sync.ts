import { ipcMain } from 'electron'
import { SyncManager } from '../sync/sync-manager'
import { SecureKeyStore, type SafeStorageAdapter } from '../security/secure-key-store'
import type { WebDavConfig } from '../sync/webdav-client'
import {
  IpcWebDavConfigInputSchema,
  IpcSetWebDavPasswordInputSchema
} from '../../shared/schemas/ipc'

const WEBDAV_PASSWORD_FILE = 'webdav-password.enc'

/**
 * Register IPC handlers for WebDAV sync.
 *
 * The renderer only ever sends the non-secret fields ({url, username}).
 * The password is stored encrypted in the main process via safeStorage
 * and injected here — it never travels over IPC and is never returned
 * to the renderer.
 */
export function registerSyncIpc(dataRoot: string, safeStorage: SafeStorageAdapter): void {
  const manager = new SyncManager(dataRoot)
  const passwordStore = new SecureKeyStore(dataRoot, safeStorage, WEBDAV_PASSWORD_FILE)

  async function resolveConfig(input: unknown): Promise<WebDavConfig> {
    const parsed = IpcWebDavConfigInputSchema.parse(input)
    const password = await passwordStore.readKey()
    if (!password) {
      throw new Error('WebDAV password not set — enter it in the sync settings first')
    }
    return { url: parsed.url, username: parsed.username, password }
  }

  ipcMain.handle('sync:has-webdav-password', async () => {
    return passwordStore.hasKey()
  })

  ipcMain.handle('sync:set-webdav-password', async (_event, input: unknown) => {
    const parsed = IpcSetWebDavPasswordInputSchema.parse(input)
    await passwordStore.setKey(parsed.password)
  })

  ipcMain.handle('sync:test', async (_event, input: unknown) => {
    return manager.test(await resolveConfig(input))
  })

  ipcMain.handle('sync:plan-push', async (_event, input: unknown) => {
    return manager.planPush(await resolveConfig(input))
  })

  ipcMain.handle('sync:plan-pull', async (_event, input: unknown) => {
    return manager.planPull(await resolveConfig(input))
  })

  ipcMain.handle('sync:push', async (event, input: unknown) => {
    const result = await manager.push(await resolveConfig(input), (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('sync:progress', progress)
    })
    if (result.success) {
      return { ...result, timestamp: new Date().toISOString() }
    }
    return result
  })

  ipcMain.handle('sync:pull', async (event, input: unknown) => {
    const result = await manager.pull(await resolveConfig(input), (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('sync:progress', progress)
    })
    if (result.success) {
      return { ...result, timestamp: new Date().toISOString() }
    }
    return result
  })

  ipcMain.handle('sync:list-trash', async (_event, input: unknown) => {
    return manager.listRemoteTrash(await resolveConfig(input))
  })

  ipcMain.handle('sync:empty-trash', async (_event, input: unknown) => {
    return manager.emptyRemoteTrash(await resolveConfig(input))
  })
}
