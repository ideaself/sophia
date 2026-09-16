// @vitest-environment jsdom
/**
 * SettingsArchiveSection — recycle bin: list / restore / purge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

import { SettingsArchiveSection } from '../../../src/renderer/src/components/SettingsArchiveSection'

const archiveApi = {
  list: vi.fn(),
  restore: vi.fn(),
  purge: vi.fn()
}

const entry = {
  id: 'entry_1',
  kind: 'conversation',
  label: '07-06 爱丽丝',
  movedAt: '2026-07-06T10:00:00Z',
  originalPath: 'conversations/c1'
}

beforeEach(() => {
  for (const fn of Object.values(archiveApi)) fn.mockClear()
  archiveApi.list.mockResolvedValue([entry])
  archiveApi.restore.mockResolvedValue({ success: true })
  archiveApi.purge.mockResolvedValue({ success: true })

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data: { archive: archiveApi } }
  })
})

afterEach(() => {
  cleanup()
})

/** The section renders collapsed by default — expand it before asserting. */
function renderExpanded(): void {
  render(<SettingsArchiveSection />)
  fireEvent.click(screen.getByRole('button', { name: /历史归档/ }))
}

describe('SettingsArchiveSection', () => {
  it('lists archived items with kind label and count badge', async () => {
    renderExpanded()

    expect(await screen.findByText('07-06 爱丽丝')).toBeTruthy()
    expect(screen.getByText('课堂')).toBeTruthy()
    expect(screen.getByText('1 项')).toBeTruthy()
  })

  it('shows the empty state', async () => {
    archiveApi.list.mockResolvedValueOnce([])
    renderExpanded()

    expect(await screen.findByText('暂无归档内容')).toBeTruthy()
  })

  it('restores an item and reports success', async () => {
    renderExpanded()
    await screen.findByText('07-06 爱丽丝')

    fireEvent.click(screen.getByText('恢复'))

    await waitFor(() => expect(archiveApi.restore).toHaveBeenCalledWith('entry_1'))
    expect(await screen.findByText('已恢复到原位置')).toBeTruthy()
    // The list is reloaded after the restore.
    expect(archiveApi.list.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('purges only after inline confirmation', async () => {
    renderExpanded()
    await screen.findByText('07-06 爱丽丝')

    fireEvent.click(screen.getByText('永久删除'))
    expect(archiveApi.purge).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('确认删除'))
    await waitFor(() => expect(archiveApi.purge).toHaveBeenCalledWith('entry_1'))
    expect(await screen.findByText('已永久删除')).toBeTruthy()
  })
})
