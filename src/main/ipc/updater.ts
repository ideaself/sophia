import { ipcMain } from 'electron'
import { checkForUpdatesNow } from '../auto-update'

/**
 * Manual update check for the settings UI.
 *
 * The background check/download stays in auto-update.ts; this only exposes a
 * user-triggered check with a discriminated result. No input parameters —
 * nothing to validate on the IPC boundary.
 */
export function registerUpdaterIpc(): void {
  /* v8 ignore next -- @preserve */
  ipcMain.handle('updater:check-for-updates', async () => checkForUpdatesNow())
}
