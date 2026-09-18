// @vitest-environment jsdom
/**
 * Extracted settings sections: font scale / lock / classroom behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

import { SettingsFontScaleSection } from '../../../src/renderer/src/components/SettingsFontScaleSection'
import { SettingsLockSection } from '../../../src/renderer/src/components/SettingsLockSection'
import { SettingsClassroomBehaviorSection } from '../../../src/renderer/src/components/SettingsClassroomBehaviorSection'
import { SettingsView } from '../../../src/renderer/src/components/SettingsView'

const lockApi = {
  has: vi.fn(),
  set: vi.fn(),
  clear: vi.fn()
}

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(lockApi)) fn.mockClear()
  lockApi.has.mockResolvedValue(false)
  lockApi.set.mockResolvedValue(undefined)
  lockApi.clear.mockResolvedValue(undefined)

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data: { lock: lockApi } }
  })
})

afterEach(() => {
  cleanup()
})

describe('SettingsFontScaleSection', () => {
  it('persists the chosen font scale', () => {
    render(<SettingsFontScaleSection />)

    fireEvent.click(screen.getByText('标准'))
    expect(localStorage.getItem('sophia.fontScale')).toBe('standard')

    fireEvent.click(screen.getByText('超大'))
    expect(localStorage.getItem('sophia.fontScale')).toBe('xlarge')
    // The root font size drives Tailwind's rem-based scale.
    expect(document.documentElement.style.fontSize).toBe('20px')
  })
})

describe('SettingsLockSection', () => {
  it('validates the pin before enabling the lock', async () => {
    render(<SettingsLockSection />)
    await waitFor(() => expect(screen.getByText('启用档案锁')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText(/设置解锁密码/), { target: { value: '12' } })
    fireEvent.change(screen.getByPlaceholderText('再次输入确认'), { target: { value: '12' } })
    fireEvent.click(screen.getByText('启用档案锁'))
    expect(await screen.findByText('密码至少 4 位')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText(/设置解锁密码/), { target: { value: '1234' } })
    fireEvent.change(screen.getByPlaceholderText('再次输入确认'), { target: { value: '9999' } })
    fireEvent.click(screen.getByText('启用档案锁'))
    expect(await screen.findByText('两次输入的密码不一致')).toBeTruthy()
    expect(lockApi.set).not.toHaveBeenCalled()
  })

  it('enables the lock and switches to the enabled panel', async () => {
    render(<SettingsLockSection />)
    await waitFor(() => expect(screen.getByText('启用档案锁')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText(/设置解锁密码/), { target: { value: '1234' } })
    fireEvent.change(screen.getByPlaceholderText('再次输入确认'), { target: { value: '1234' } })
    lockApi.has.mockResolvedValue(true)
    fireEvent.click(screen.getByText('启用档案锁'))

    await waitFor(() => expect(lockApi.set).toHaveBeenCalledWith('1234'))
    expect(await screen.findByText(/已启用档案锁/)).toBeTruthy()
    expect(await screen.findByText('立即锁定')).toBeTruthy()
  })

  it('relocks immediately and can turn the lock off', async () => {
    lockApi.has.mockResolvedValue(true)
    render(<SettingsLockSection />)
    await waitFor(() => expect(screen.getByText('立即锁定')).toBeTruthy())

    const relockListener = vi.fn()
    window.addEventListener('sophia:relock', relockListener)
    fireEvent.click(screen.getByText('立即锁定'))
    expect(relockListener).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('已锁定')).toBeTruthy()
    window.removeEventListener('sophia:relock', relockListener)

    lockApi.has.mockResolvedValue(false)
    fireEvent.click(screen.getByText('关闭档案锁'))
    await waitFor(() => expect(lockApi.clear).toHaveBeenCalled())
    expect(await screen.findByText('已关闭档案锁')).toBeTruthy()
  })
})

describe('SettingsClassroomBehaviorSection', () => {
  it('persists thinking mode, daily goal and narration preference', () => {
    render(<SettingsClassroomBehaviorSection />)

    fireEvent.click(screen.getByText('关闭'))
    expect(localStorage.getItem('sophia.thinkingEnabled')).toBe('0')

    const goalInput = screen.getByRole('spinbutton')
    fireEvent.change(goalInput, { target: { value: '45' } })
    expect(localStorage.getItem('sophia.dailyGoal')).toBe('45')

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toHaveProperty('checked', false)
    fireEvent.click(checkbox)
    expect(localStorage.getItem('sophia.hideNarration')).toBe('1')
  })

  it('turns narration hiding back off', () => {
    localStorage.setItem('sophia.hideNarration', '1')
    render(<SettingsClassroomBehaviorSection />)

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toHaveProperty('checked', true)
    fireEvent.click(checkbox)
    expect(localStorage.getItem('sophia.hideNarration')).toBe('0')
  })

  it('dispatches a goal-changed event so the classroom ring refreshes', () => {
    const listener = vi.fn()
    window.addEventListener('sophia:goal-changed', listener)
    render(<SettingsClassroomBehaviorSection />)

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '30' } })
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('sophia:goal-changed', listener)
  })
})

describe('SettingsLockSection — failure branches', () => {
  it('shows Error messages from lock-set failures', async () => {
    render(<SettingsLockSection />)
    await waitFor(() => expect(screen.getByText('启用档案锁')).toBeTruthy())

    lockApi.set.mockRejectedValueOnce(new Error('keychain locked'))
    fireEvent.change(screen.getByPlaceholderText(/设置解锁密码/), { target: { value: '1234' } })
    fireEvent.change(screen.getByPlaceholderText('再次输入确认'), { target: { value: '1234' } })
    fireEvent.click(screen.getByText('启用档案锁'))

    expect(await screen.findByText('keychain locked')).toBeTruthy()
  })

  it('treats an unreadable lock state as unlocked and reports set failures', async () => {
    lockApi.has.mockRejectedValueOnce(new Error('db closed'))
    render(<SettingsLockSection />)
    await waitFor(() => expect(screen.getByText('启用档案锁')).toBeTruthy())

    lockApi.set.mockRejectedValueOnce('plain failure')
    fireEvent.change(screen.getByPlaceholderText(/设置解锁密码/), { target: { value: '1234' } })
    fireEvent.change(screen.getByPlaceholderText('再次输入确认'), { target: { value: '1234' } })
    fireEvent.click(screen.getByText('启用档案锁'))

    expect(await screen.findByText('设置失败')).toBeTruthy()
  })
})

describe('SettingsView', () => {
  it('renders the settings shell with its sections', async () => {
    Object.defineProperty(window, 'sophia', {
      configurable: true,
      value: {
        data: {
          lock: lockApi,
          archive: { list: vi.fn(async () => []) }
        },
        providers: { list: vi.fn(async () => []) },
        getVersion: vi.fn(async () => '0.1.0'),
        sync: {
          hasWebdavPassword: vi.fn(async () => false),
          onProgress: vi.fn(() => () => {})
        }
      }
    })

    render(<SettingsView />)

    expect(screen.getByText('设置')).toBeTruthy()
    expect(screen.getByText('界面字号')).toBeTruthy()
    expect(await screen.findByText('尚未配置模型服务')).toBeTruthy()
    expect(screen.getByText(/Sophia v0\.1\.0/)).toBeTruthy()
  })
})
