import type { WebContents } from 'electron'

/**
 * Send an IPC event to a renderer, skipping contents that were already
 * destroyed.
 *
 * `webContents.send` throws on a destroyed contents. That exception can
 * poison background queues (a rejected serial queue never runs its next
 * task) or escape as an unhandled rejection while the app is shutting
 * down, so every fire-and-forget send should go through here.
 */
export function safeSend(wc: WebContents, channel: string, payload: unknown): void {
  try {
    if (wc.isDestroyed()) return
    wc.send(channel, payload)
  } catch (err) {
    // Window torn down between the check and the send — nothing to notify.
    console.warn(
      `[safeSend] dropped ${channel}:`,
      err instanceof Error ? err.message : String(err)
    )
  }
}
