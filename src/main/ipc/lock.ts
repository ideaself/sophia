import { ipcMain } from 'electron'
import { SecureKeyStore, type SafeStorageAdapter } from '../security/secure-key-store'
import {
  IpcLockSetInputSchema,
  IpcLockVerifyInputSchema
} from '../../shared/schemas/ipc'

/** Encrypted PIN file (separate from the API key file). */
const LOCK_FILE_NAME = 'profile-lock.enc'

function createElectronSafeStorageAdapter(safeStorage: Electron.SafeStorage): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plaintext: string) => safeStorage.encryptString(plaintext),
    decryptString: (encrypted: Buffer) => safeStorage.decryptString(encrypted)
  }
}

/**
 * Profile lock (3.0.0) — a convenience PIN to keep prying eyes out of a
 * shared computer. The PIN is stored encrypted (safeStorage), never in
 * plaintext, and never returned to the renderer — the renderer only asks
 * "does this PIN unlock?".
 */
export function registerLockIpc(dataRoot: string, safeStorage: Electron.SafeStorage): void {
  const store = new SecureKeyStore(dataRoot, createElectronSafeStorageAdapter(safeStorage), LOCK_FILE_NAME)

  ipcMain.handle('lock:has', async () => store.hasKey())

  ipcMain.handle('lock:set', async (_event, input: unknown) => {
    const parsed = IpcLockSetInputSchema.parse(input)
    await store.setKey(parsed.pin)
    return { success: true }
  })

  ipcMain.handle('lock:verify', async (_event, input: unknown) => {
    const parsed = IpcLockVerifyInputSchema.parse(input)
    const stored = await store.readKey()
    if (stored === null) return false
    return stored === parsed.pin
  })

  ipcMain.handle('lock:clear', async () => {
    await store.deleteKey()
    return { success: true }
  })
}
