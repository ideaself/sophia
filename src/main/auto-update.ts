/**
 * Auto-update for packaged builds (electron-updater + GitHub Releases).
 *
 * Behaviour:
 * - only runs in packaged builds (`app.isPackaged`) — dev never phones home;
 * - the first check is delayed so startup and class loading are unaffected;
 * - updates download in the background and install on the next quit
 *   (`autoInstallOnAppQuit`), so nothing interrupts an in-progress class;
 * - every failure is logged and swallowed — an unreachable/empty feed
 *   (e.g. no release published yet) must never break the app.
 *
 * The feed is configured by `build.publish` in package.json; electron-builder
 * writes `resources/app-update.yml` from it and the release workflow uploads
 * `latest.yml` alongside the installer.
 */

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdaterCheckResult } from '../shared/updater'

/** Wait this long after launch before the first check. */
const FIRST_CHECK_DELAY_MS = 30_000

function logUpdateError(err: unknown): void {
  console.warn('[updater] update check failed:', err instanceof Error ? err.message : err)
}

/**
 * User-triggered check (设置页「检查更新」). With `autoDownload` enabled a
 * found update starts downloading in the background and installs on quit —
 * the result therefore only reports availability, not download progress.
 * Never throws: failures come back as `{ status: 'error' }`.
 */
export async function checkForUpdatesNow(): Promise<UpdaterCheckResult> {
  if (!app.isPackaged) return { status: 'disabled' }
  try {
    const result = await autoUpdater.checkForUpdates()
    // null = updater inactive (only possible outside packaged builds).
    if (!result) return { status: 'disabled' }
    return result.isUpdateAvailable
      ? { status: 'update-available', version: result.updateInfo.version }
      : { status: 'up-to-date' }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

export function setupAutoUpdate(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', logUpdateError)

  const timer = setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(logUpdateError)
  }, FIRST_CHECK_DELAY_MS)
  // Don't keep the process alive just for the update timer.
  if (typeof timer.unref === 'function') timer.unref()
}
