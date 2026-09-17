// @vitest-environment jsdom
/**
 * SettingsBackupSection + SettingsConfigSection — data backup & settings portability.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

import { SettingsBackupSection } from '../../../src/renderer/src/components/SettingsBackupSection'
import { SettingsConfigSection } from '../../../src/renderer/src/components/SettingsConfigSection'

const api = {
  exportBackup: vi.fn(),
  restoreBackup: vi.fn(),
  writeTextFile: vi.fn(),
  openDataDir: vi.fn(),
  saveFile: vi.fn(),
  openFile: vi.fn(),
  confirm: vi.fn()
}

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(api)) fn.mockClear()
  api.exportBackup.mockResolvedValue({ fileCount: 7 })
  api.restoreBackup.mockResolvedValue({ success: true })
  api.writeTextFile.mockResolvedValue({ success: true })
  api.openDataDir.mockResolvedValue({ success: true })
  api.saveFile.mockResolvedValue({ canceled: false, filePath: 'C:/out.bin' })
  api.openFile.mockResolvedValue({ canceled: false, filePaths: ['C:/backup.zip'] })
  api.confirm.mockResolvedValue(true)

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: {
      data: {
        exportBackup: api.exportBackup,
        restoreBackup: api.restoreBackup,
        writeTextFile: api.writeTextFile
      },
      app: { openDataDir: api.openDataDir },
      dialog: {
        saveFile: api.saveFile,
        openFile: api.openFile,
        confirm: api.confirm
      }
    }
  })
})

afterEach(() => {
  cleanup()
})

describe('SettingsBackupSection', () => {
  it('exports a backup and reports the file count', async () => {
    render(<SettingsBackupSection />)

    fireEvent.click(screen.getByText('导出全部数据备份'))

    await waitFor(() => expect(api.exportBackup).toHaveBeenCalledWith('C:/out.bin'))
    expect(await screen.findByText('备份完成，共 7 个文件')).toBeTruthy()
  })

  it('restores after confirmation', async () => {
    render(<SettingsBackupSection />)

    fireEvent.click(screen.getByText('从备份恢复'))

    await waitFor(() => expect(api.restoreBackup).toHaveBeenCalledWith('C:/backup.zip'))
    expect(api.confirm).toHaveBeenCalled()
    expect(await screen.findByText(/恢复成功/)).toBeTruthy()
  })

  it('does not restore when the confirmation is declined', async () => {
    api.confirm.mockResolvedValueOnce(false)
    render(<SettingsBackupSection />)

    fireEvent.click(screen.getByText('从备份恢复'))

    await waitFor(() => expect(api.confirm).toHaveBeenCalled())
    expect(api.openFile).not.toHaveBeenCalled()
    expect(api.restoreBackup).not.toHaveBeenCalled()
  })

  it('opens the data directory', async () => {
    render(<SettingsBackupSection />)
    fireEvent.click(screen.getByText('打开数据目录'))
    await waitFor(() => expect(api.openDataDir).toHaveBeenCalled())
  })
})

describe('SettingsConfigSection', () => {
  it('exports only whitelisted settings keys', async () => {
    localStorage.setItem('sophia-theme', 'dark')
    localStorage.setItem('sophia.fontScale', '1.1')
    localStorage.setItem('sophia.secret-not-whitelisted', 'nope')

    render(<SettingsConfigSection />)
    fireEvent.click(screen.getByText('导出配置'))

    await waitFor(() => expect(api.writeTextFile).toHaveBeenCalledTimes(1))
    const payload = JSON.parse(api.writeTextFile.mock.calls[0][1] as string)
    expect(payload.settings['sophia-theme']).toBe('dark')
    expect(payload.settings['sophia.fontScale']).toBe('1.1')
    expect(payload.settings['sophia.secret-not-whitelisted']).toBeUndefined()
    expect(await screen.findByText(/已导出 2 项设置/)).toBeTruthy()
  })

  it('rejects an invalid import file with a readable error', async () => {
    const { container } = render(<SettingsConfigSection />)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

    const bad = new File(['not json at all'], 'bad.json', { type: 'application/json' })
    fireEvent.change(fileInput, { target: { files: [bad] } })

    expect(await screen.findByText('导入失败：文件格式不正确')).toBeTruthy()
  })
})

describe('SettingsConfigSection — import branches', () => {
  it('skips the export when the save dialog is cancelled', async () => {
    api.saveFile.mockResolvedValueOnce({ canceled: true, filePath: '' })
    render(<SettingsConfigSection />)

    fireEvent.click(screen.getByText('导出配置'))

    await waitFor(() => expect(api.saveFile).toHaveBeenCalled())
    expect(api.writeTextFile).not.toHaveBeenCalled()
  })

  it('applies a valid settings file and reloads', async () => {
    const { container } = render(<SettingsConfigSection />)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

    const good = new File(
      [JSON.stringify({ app: 'sophia', version: 1, settings: { 'sophia-theme': 'dark', 'sophia.bad': 'x' } })],
      'good.json',
      { type: 'application/json' }
    )
    fireEvent.change(fileInput, { target: { files: [good] } })

    await waitFor(() => expect(localStorage.getItem('sophia-theme')).toBe('dark'))
    expect(localStorage.getItem('sophia.bad')).toBeNull()
  })

  it('accepts a bare settings object without the wrapper', async () => {
    const { container } = render(<SettingsConfigSection />)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

    const bare = new File([JSON.stringify({ 'sophia.fontScale': '1.25' })], 'bare.json', {
      type: 'application/json'
    })
    fireEvent.change(fileInput, { target: { files: [bare] } })

    await waitFor(() => expect(localStorage.getItem('sophia.fontScale')).toBe('1.25'))
  })

  it('rejects files that carry no usable settings', async () => {
    const { container } = render(<SettingsConfigSection />)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

    const empty = new File([JSON.stringify({ settings: { unknown: 'x' } })], 'empty.json')
    fireEvent.change(fileInput, { target: { files: [empty] } })

    expect(await screen.findByText('导入失败：文件格式不正确')).toBeTruthy()
  })

  it('rejects a non-object settings payload', async () => {
    const { container } = render(<SettingsConfigSection />)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

    const odd = new File([JSON.stringify({ settings: 42 })], 'odd.json')
    fireEvent.change(fileInput, { target: { files: [odd] } })

    expect(await screen.findByText('导入失败：文件格式不正确')).toBeTruthy()
  })

  it('reports read failures from the file reader', async () => {
    const OriginalReader = window.FileReader
    class FailingReader {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsText(): void {
        this.onerror?.()
      }
    }
    vi.stubGlobal('FileReader', FailingReader)
    try {
      const { container } = render(<SettingsConfigSection />)
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['x'], 'x.json')

      fireEvent.change(fileInput, { target: { files: [file] } })

      expect(await screen.findByText('读取文件失败')).toBeTruthy()
    } finally {
      vi.stubGlobal('FileReader', OriginalReader)
    }
  })
})
