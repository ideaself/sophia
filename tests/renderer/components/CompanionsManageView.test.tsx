// @vitest-environment jsdom
/**
 * CompanionsManageView — companion cards: edit lookup, start conversation,
 * two-step delete and the create entry point.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

import { CompanionsManageView } from '../../../src/renderer/src/components/CompanionsManageView'
import { useCompanionStore } from '../../../src/renderer/src/stores/useCompanionStore'

const companions = {
  get: vi.fn(),
  delete: vi.fn()
}

const LANDAU = {
  id: 'comp_landau',
  name: '朗道',
  identity: '理论物理学家',
  personalityKeywords: ['严密', '直率'],
  version: 3
}

beforeEach(() => {
  companions.get.mockReset()
  companions.delete.mockReset()
  companions.get.mockResolvedValue({ ...LANDAU, personality: 'p' })
  companions.delete.mockResolvedValue(true)

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { companions, data: {} }
  })

  useCompanionStore.setState({
    companions: [LANDAU as never],
    selectedCompanion: null,
    editingCompanion: null,
    isCreating: false,
    fetch: vi.fn(async () => {})
  })
})

afterEach(cleanup)

describe('CompanionsManageView', () => {
  it('renders the card with version, identity and keywords', () => {
    render(<CompanionsManageView onStartConversation={vi.fn()} />)

    expect(screen.getByText('朗道')).toBeTruthy()
    expect(screen.getByText('v3')).toBeTruthy()
    expect(screen.getByText('理论物理学家')).toBeTruthy()
    expect(screen.getByText('严密')).toBeTruthy()
    expect(screen.getByText('直率')).toBeTruthy()
    expect(screen.queryByText('暂无可用角色。')).toBeNull()
  })

  it('loads the full record before editing', async () => {
    const startEdit = vi.fn()
    useCompanionStore.setState({ startEdit })
    render(<CompanionsManageView onStartConversation={vi.fn()} />)

    fireEvent.click(screen.getByText('朗道'))

    await waitFor(() => expect(startEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'comp_landau' })))
  })

  it('does not open the editor when the record is gone', async () => {
    const startEdit = vi.fn()
    useCompanionStore.setState({ startEdit })
    companions.get.mockResolvedValue(null)

    render(<CompanionsManageView onStartConversation={vi.fn()} />)
    fireEvent.click(screen.getByText('朗道'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(startEdit).not.toHaveBeenCalled()
  })

  it('starts a conversation with the clicked companion', () => {
    const onStart = vi.fn()
    render(<CompanionsManageView onStartConversation={onStart} />)

    fireEvent.click(screen.getByText('开始对话'))

    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'comp_landau' }))
  })

  it('confirms a delete, refreshes and can be cancelled first', async () => {
    const fetch = vi.fn(async () => {})
    useCompanionStore.setState({ fetch })
    render(<CompanionsManageView onStartConversation={vi.fn()} />)

    // Cancelling leaves no request behind.
    fireEvent.click(screen.getByTitle('删除角色'))
    fireEvent.click(screen.getByText('取消'))
    expect(companions.delete).not.toHaveBeenCalled()
    expect(screen.getByTitle('删除角色')).toBeTruthy()

    fireEvent.click(screen.getByTitle('删除角色'))
    fireEvent.click(screen.getByText('确认删除'))

    await waitFor(() => expect(companions.delete).toHaveBeenCalledWith('comp_landau'))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByTitle('删除角色')).toBeTruthy()
  })

  it('opens create mode and shows the empty state', () => {
    const startCreate = vi.fn()
    useCompanionStore.setState({ companions: [], startCreate })
    render(<CompanionsManageView onStartConversation={vi.fn()} />)

    expect(screen.getByText('暂无可用角色。')).toBeTruthy()
    fireEvent.click(screen.getByText('+ 添加自定义角色'))
    expect(startCreate).toHaveBeenCalled()
  })
})
