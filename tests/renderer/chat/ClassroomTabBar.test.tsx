// @vitest-environment jsdom
/**
 * ClassroomTabBar — tablist semantics + interaction wiring.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { ClassroomTabBar } from '../../../src/renderer/src/chat/ClassroomTabBar'

afterEach(() => {
  cleanup()
})

const TABS = [
  { id: 't1', title: '07-06 爱丽丝' },
  { id: 't2', title: '07-05 福尔摩斯' }
]

function renderBar(overrides: Partial<Parameters<typeof ClassroomTabBar>[0]> = {}) {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const onNew = vi.fn()
  render(
    <ClassroomTabBar
      tabs={TABS}
      activeIdx={0}
      onSelect={onSelect}
      onClose={onClose}
      onNew={onNew}
      {...overrides}
    />
  )
  return { onSelect, onClose, onNew }
}

describe('ClassroomTabBar', () => {
  it('exposes tablist semantics and marks the active tab', () => {
    renderBar()
    expect(screen.getByRole('tablist', { name: '课堂标签页' })).toBeTruthy()

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].getAttribute('aria-selected')).toBe('false')
    // Only the active tab is in the tab order.
    expect(tabs[0].getAttribute('tabindex')).toBe('0')
    expect(tabs[1].getAttribute('tabindex')).toBe('-1')
  })

  it('selects a tab on click and on Enter/Space', () => {
    const { onSelect } = renderBar()
    fireEvent.click(screen.getByText('07-05 福尔摩斯'))
    expect(onSelect).toHaveBeenCalledWith(1)

    fireEvent.keyDown(screen.getByText('07-06 爱丽丝'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByText('07-06 爱丽丝'), { key: ' ' })
    expect(onSelect).toHaveBeenCalledTimes(3)
  })

  it('closes a tab without also selecting it', () => {
    const { onClose, onSelect } = renderBar()
    fireEvent.click(screen.getByLabelText('关闭标签 07-05 福尔摩斯'))
    expect(onClose).toHaveBeenCalledWith(1)
    // stopPropagation prevents the tab selection handler from firing.
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('hides close buttons when only one tab exists', () => {
    renderBar({ tabs: [TABS[0]] })
    expect(screen.queryByLabelText(/关闭标签/)).toBeNull()
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('creates a new tab via the + button', () => {
    const { onNew } = renderBar()
    fireEvent.click(screen.getByLabelText('新建对话'))
    expect(onNew).toHaveBeenCalledTimes(1)
  })
})
