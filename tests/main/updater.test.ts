/**
 * auto-update — manual check result mapping and background scheduling.
 * electron / electron-updater are mocked; no timers fire for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { checkForUpdates, checkForUpdatesAndNotify, autoUpdaterOn, appState } = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  checkForUpdatesAndNotify: vi.fn(),
  autoUpdaterOn: vi.fn(),
  appState: { isPackaged: true }
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged
    },
    getVersion: () => '0.1.0'
  }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    checkForUpdates,
    checkForUpdatesAndNotify,
    on: autoUpdaterOn
  }
}))

import { checkForUpdatesNow, setupAutoUpdate } from '../../src/main/auto-update'

beforeEach(() => {
  appState.isPackaged = true
  checkForUpdates.mockReset()
  checkForUpdatesAndNotify.mockReset()
  autoUpdaterOn.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('checkForUpdatesNow', () => {
  it('reports disabled outside packaged builds without touching the network', async () => {
    appState.isPackaged = false

    await expect(checkForUpdatesNow()).resolves.toEqual({ status: 'disabled' })
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('reports an available update with its version', async () => {
    checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.2.0' }
    })

    await expect(checkForUpdatesNow()).resolves.toEqual({
      status: 'update-available',
      version: '0.2.0'
    })
  })

  it('reports up-to-date when the feed has nothing newer', async () => {
    checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: '0.1.0' }
    })

    await expect(checkForUpdatesNow()).resolves.toEqual({ status: 'up-to-date' })
  })

  it('treats a null result as disabled (updater inactive)', async () => {
    checkForUpdates.mockResolvedValue(null)

    await expect(checkForUpdatesNow()).resolves.toEqual({ status: 'disabled' })
  })

  it('maps failures to an error result instead of throwing', async () => {
    checkForUpdates.mockRejectedValue(new Error('offline'))

    await expect(checkForUpdatesNow()).resolves.toEqual({
      status: 'error',
      message: 'offline'
    })
  })

  it('stringifies non-Error rejections', async () => {
    checkForUpdates.mockRejectedValue('boom')

    await expect(checkForUpdatesNow()).resolves.toEqual({
      status: 'error',
      message: 'boom'
    })
  })
})

describe('setupAutoUpdate', () => {
  it('does nothing outside packaged builds', async () => {
    appState.isPackaged = false
    setupAutoUpdate()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(checkForUpdatesAndNotify).not.toHaveBeenCalled()
    expect(autoUpdaterOn).not.toHaveBeenCalled()
  })

  it('checks in the background after the startup delay and logs failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    checkForUpdatesAndNotify.mockRejectedValue(new Error('no releases yet'))
    setupAutoUpdate()

    expect(autoUpdaterOn).toHaveBeenCalledWith('error', expect.any(Function))

    await vi.advanceTimersByTimeAsync(29_999)
    expect(checkForUpdatesAndNotify).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(checkForUpdatesAndNotify).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
  })

  it('logs non-Error background failures verbatim', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    checkForUpdatesAndNotify.mockRejectedValue('offline')
    setupAutoUpdate()

    await vi.advanceTimersByTimeAsync(30_000)

    expect(warn).toHaveBeenCalledWith('[updater] update check failed:', 'offline')
  })

  it('skips unref when the timer has no unref function', () => {
    vi.spyOn(globalThis, 'setTimeout').mockReturnValue(123 as unknown as ReturnType<typeof setTimeout>)

    expect(() => setupAutoUpdate()).not.toThrow()
    expect(autoUpdaterOn).toHaveBeenCalledWith('error', expect.any(Function))
  })
})
