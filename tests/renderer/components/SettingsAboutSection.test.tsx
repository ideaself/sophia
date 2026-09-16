// @vitest-environment jsdom
/**
 * SettingsAboutSection — app version + manual update check feedback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { SettingsAboutSection } from '../../../src/renderer/src/components/SettingsAboutSection'
import type { UpdaterCheckResult } from '../../../src/shared/updater'

const getVersion = vi.fn()
const checkForUpdates = vi.fn()

beforeEach(() => {
  getVersion.mockReset().mockResolvedValue('0.1.0')
  checkForUpdates.mockReset()
  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { getVersion, updater: { checkForUpdates } }
  })
})

afterEach(cleanup)

function checkButton(): HTMLButtonElement {
  return screen.getByText('检查更新').closest('button') as HTMLButtonElement
}

describe('SettingsAboutSection', () => {
  it('shows the app version', async () => {
    render(<SettingsAboutSection />)

    expect(await screen.findByText('Sophia v0.1.0')).toBeTruthy()
    expect(getVersion).toHaveBeenCalledTimes(1)
  })

  it('reports an up-to-date app', async () => {
    checkForUpdates.mockResolvedValue({ status: 'up-to-date' } satisfies UpdaterCheckResult)
    render(<SettingsAboutSection />)

    fireEvent.click(checkButton())
    expect(await screen.findByText('已是最新版本。')).toBeTruthy()
  })

  it('reports a found update and that it installs on quit', async () => {
    checkForUpdates.mockResolvedValue({
      status: 'update-available',
      version: '0.2.0'
    } satisfies UpdaterCheckResult)
    render(<SettingsAboutSection />)

    fireEvent.click(checkButton())
    expect(
      await screen.findByText('发现新版本 v0.2.0，已开始后台下载，退出应用时自动安装。')
    ).toBeTruthy()
  })

  it('explains that dev runs never check for updates', async () => {
    checkForUpdates.mockResolvedValue({ status: 'disabled' } satisfies UpdaterCheckResult)
    render(<SettingsAboutSection />)

    fireEvent.click(checkButton())
    expect(await screen.findByText('开发模式（未安装版）不检查更新。')).toBeTruthy()
  })

  it('surfaces a failed check from the updater result', async () => {
    checkForUpdates.mockResolvedValue({
      status: 'error',
      message: 'net::ERR_INTERNET_DISCONNECTED'
    } satisfies UpdaterCheckResult)
    render(<SettingsAboutSection />)

    fireEvent.click(checkButton())
    expect(await screen.findByText('检查失败：net::ERR_INTERNET_DISCONNECTED')).toBeTruthy()
  })

  it('surfaces an IPC-level rejection too', async () => {
    checkForUpdates.mockRejectedValue(new Error('channel closed'))
    render(<SettingsAboutSection />)

    fireEvent.click(checkButton())
    expect(await screen.findByText('检查失败：channel closed')).toBeTruthy()
  })

  it('disables the button and shows progress while checking', async () => {
    let resolveCheck!: (result: UpdaterCheckResult) => void
    checkForUpdates.mockReturnValue(
      new Promise<UpdaterCheckResult>((resolve) => {
        resolveCheck = resolve
      })
    )
    render(<SettingsAboutSection />)

    fireEvent.click(checkButton())
    expect(checkButton().disabled).toBe(true)
    expect(screen.getByText('检查中…')).toBeTruthy()

    resolveCheck({ status: 'up-to-date' })
    await waitFor(() => expect(checkButton().disabled).toBe(false))
    expect(screen.getByText('已是最新版本。')).toBeTruthy()
  })
})
