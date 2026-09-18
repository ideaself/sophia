// @vitest-environment jsdom
/**
 * useConversationStore — fetches active conversations and enriches them with
 * companion/textbook names in one batched pass (deduped lookups).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useConversationStore } from '../../../src/renderer/src/stores/useConversationStore'

const data = {
  listConversations: vi.fn(),
  getTextbook: vi.fn()
}
const companions = { get: vi.fn() }

function conv(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'c1',
    companionId: 'comp_a',
    textbookId: null,
    title: '课堂',
    updatedAt: '2026-09-16T10:00:00Z',
    endedAt: null,
    ...overrides
  }
}

beforeEach(() => {
  data.listConversations.mockReset()
  data.getTextbook.mockReset()
  companions.get.mockReset()
  useConversationStore.setState({ activeConversations: [] })

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data, companions }
  })
})

describe('useConversationStore.fetchActive', () => {
  it('filters ended classes and enriches names with deduped lookups', async () => {
    data.listConversations.mockResolvedValue([
      conv({ id: 'c1', companionId: 'comp_a', textbookId: 'tb_1' }),
      conv({ id: 'c2', companionId: 'comp_a', textbookId: 'tb_1', updatedAt: '2026-09-15T10:00:00Z' }),
      conv({ id: 'c3', companionId: 'comp_gone', textbookId: 'tb_gone', endedAt: '2026-09-01T00:00:00Z' })
    ])
    companions.get.mockImplementation(async (id: string) => {
      if (id === 'comp_a') return { id, name: '朗道' }
      throw new Error('missing companion')
    })
    data.getTextbook.mockImplementation(async (id: string) => {
      if (id === 'tb_1') return { id, title: '热力学讲义' }
      return null
    })

    await useConversationStore.getState().fetchActive()

    const active = useConversationStore.getState().activeConversations
    expect(active).toHaveLength(2)
    expect(active[0]).toMatchObject({
      id: 'c1',
      companionName: '朗道',
      textbookId: 'tb_1',
      textbookTitle: '热力学讲义',
      title: '课堂'
    })
    expect(active[0]).not.toHaveProperty('endedAt')
    // Deduped: one lookup per distinct companion/textbook.
    expect(companions.get).toHaveBeenCalledTimes(1)
    expect(data.getTextbook).toHaveBeenCalledTimes(1)
  })

  it('falls back to placeholder names when lookups fail or are missing', async () => {
    data.listConversations.mockResolvedValue([
      conv({ id: 'c1', companionId: 'comp_x', textbookId: 'tb_x' })
    ])
    companions.get.mockRejectedValue(new Error('boom'))
    data.getTextbook.mockResolvedValue(null)

    await useConversationStore.getState().fetchActive()

    expect(useConversationStore.getState().activeConversations[0]).toMatchObject({
      companionName: '未知角色',
      textbookTitle: null
    })
  })

  it('keeps textbookTitle null for classes without a textbook', async () => {
    data.listConversations.mockResolvedValue([conv({ id: 'c1', textbookId: null })])
    companions.get.mockResolvedValue({ id: 'comp_a', name: '祖冲之' })

    await useConversationStore.getState().fetchActive()

    const active = useConversationStore.getState().activeConversations
    expect(active[0]).toMatchObject({ companionName: '祖冲之', textbookId: null, textbookTitle: null })
    expect(data.getTextbook).not.toHaveBeenCalled()
  })

  it('keeps the textbook title null when the lookup rejects', async () => {
    data.listConversations.mockResolvedValue([conv({ id: 'c1', textbookId: 'tb_x' })])
    companions.get.mockResolvedValue({ id: 'comp_a', name: '朗道' })
    data.getTextbook.mockRejectedValue(new Error('db closed'))

    await useConversationStore.getState().fetchActive()

    expect(useConversationStore.getState().activeConversations[0]).toMatchObject({
      textbookId: 'tb_x',
      textbookTitle: null
    })
  })

  it('clears the list when the conversation lookup fails', async () => {
    data.listConversations.mockRejectedValue(new Error('db closed'))

    await useConversationStore.getState().fetchActive()

    expect(useConversationStore.getState().activeConversations).toEqual([])
  })
})
