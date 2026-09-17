// @vitest-environment jsdom
/**
 * useCompanionStore — companion list/edit/create/save/remove state machine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useCompanionStore } from '../../../src/renderer/src/stores/useCompanionStore'

const companions = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  get: vi.fn()
}

const FORM = {
  name: '朗道',
  gender: 'male',
  age: 40,
  identity: '理论物理学家',
  personalityKeywords: ['严密'],
  personality: 'p',
  speakingStyle: 's',
  emotionalExpressions: 'e'
}

beforeEach(() => {
  for (const fn of Object.values(companions)) fn.mockReset()
  companions.list.mockResolvedValue([])
  companions.create.mockResolvedValue({ id: 'comp_new' })
  companions.update.mockResolvedValue({ id: 'comp_a' })
  companions.delete.mockResolvedValue(true)

  Object.defineProperty(window, 'sophia', { configurable: true, value: { companions } })

  useCompanionStore.setState({
    companions: [],
    selectedCompanion: null,
    editingCompanion: null,
    isCreating: false
  })
})

describe('useCompanionStore', () => {
  it('fetches and selects companions', async () => {
    companions.list.mockResolvedValue([{ id: 'comp_a', name: '朗道' }])

    await useCompanionStore.getState().fetch()
    expect(useCompanionStore.getState().companions).toHaveLength(1)

    useCompanionStore.getState().select({ id: 'comp_a', name: '朗道' } as never)
    expect(useCompanionStore.getState().selectedCompanion?.name).toBe('朗道')
    useCompanionStore.getState().select(null)
    expect(useCompanionStore.getState().selectedCompanion).toBeNull()
  })

  it('opens and closes the edit / create modals', () => {
    const store = useCompanionStore.getState()

    store.startEdit({ id: 'comp_a', name: '朗道' } as never)
    expect(useCompanionStore.getState()).toMatchObject({
      editingCompanion: { id: 'comp_a' },
      isCreating: false
    })

    store.startCreate()
    expect(useCompanionStore.getState()).toMatchObject({
      editingCompanion: null,
      isCreating: true
    })

    store.closeEdit()
    expect(useCompanionStore.getState()).toMatchObject({
      editingCompanion: null,
      isCreating: false
    })
  })

  it('creates a companion when in create mode and refreshes the list', async () => {
    companions.list.mockResolvedValue([{ id: 'comp_new', name: '朗道' }])
    useCompanionStore.getState().startCreate()

    await useCompanionStore.getState().save(FORM)

    expect(companions.create).toHaveBeenCalledWith(FORM)
    expect(companions.update).not.toHaveBeenCalled()
    expect(useCompanionStore.getState()).toMatchObject({ isCreating: false, editingCompanion: null })
    expect(useCompanionStore.getState().companions).toHaveLength(1)
  })

  it('updates the companion being edited', async () => {
    useCompanionStore.getState().startEdit({ id: 'comp_a', name: '旧名' } as never)

    await useCompanionStore.getState().save(FORM)

    expect(companions.update).toHaveBeenCalledWith('comp_a', FORM)
    expect(companions.create).not.toHaveBeenCalled()
    expect(useCompanionStore.getState().editingCompanion).toBeNull()
  })

  it('closes the modal without a request when nothing is being edited', async () => {
    await useCompanionStore.getState().save(FORM)

    expect(companions.create).not.toHaveBeenCalled()
    expect(companions.update).not.toHaveBeenCalled()
    expect(useCompanionStore.getState()).toMatchObject({ editingCompanion: null, isCreating: false })
  })

  it('removes the companion being edited and refreshes', async () => {
    useCompanionStore.getState().startEdit({ id: 'comp_a', name: '朗道' } as never)

    await useCompanionStore.getState().remove()

    expect(companions.delete).toHaveBeenCalledWith('comp_a')
    expect(useCompanionStore.getState().editingCompanion).toBeNull()
    expect(companions.list).toHaveBeenCalled()
  })

  it('does nothing on remove without an edited companion', async () => {
    await useCompanionStore.getState().remove()

    expect(companions.delete).not.toHaveBeenCalled()
    expect(companions.list).not.toHaveBeenCalled()
  })
})
