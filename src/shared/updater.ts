/**
 * Manual update-check result, shared across the main / preload / renderer
 * boundary.
 *
 * The background check/download flow lives in src/main/auto-update.ts; this
 * type only describes what a user-triggered check reports back to the UI.
 */

export type UpdaterCheckResult =
  | { status: 'update-available'; version: string }
  | { status: 'up-to-date' }
  /** Not packaged (dev run) — the updater never talks to the network. */
  | { status: 'disabled' }
  | { status: 'error'; message: string }
