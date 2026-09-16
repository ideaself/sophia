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

/** Wait this long after launch before the first check. */
const FIRST_CHECK_DELAY_MS = 30_000

function logUpdateError(err: unknown): void {
  console.warn('[updater] update check failed:', err instanceof Error ? err.message : err)
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
