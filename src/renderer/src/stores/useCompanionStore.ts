import { create } from 'zustand'
import type { Companion } from '../types/models'
import { WORLD_ID } from '../types/models'

interface CompanionForm {
  name: string
  gender: string
  age: number
  identity: string
  personalityKeywords: string[]
  personality: string
  speakingStyle: string
  emotionalExpressions: string
}

interface CompanionStore {
  companions: Companion[]
  selectedCompanion: Companion | null
  editingCompanion: CompanionDTO | null
  isCreating: boolean
  fetch: () => Promise<void>
  select: (c: Companion | null) => void
  startEdit: (c: CompanionDTO) => void
  startCreate: () => void
  closeEdit: () => void
  save: (form: CompanionForm) => Promise<void>
  remove: () => Promise<void>
}

export const useCompanionStore = create<CompanionStore>((set, get) => ({
  companions: [],
  selectedCompanion: null,
  editingCompanion: null,
  isCreating: false,

  fetch: async () => {
    const list = await window.sophia.companions.list()
    set({ companions: list })
  },

  select: (c) => set({ selectedCompanion: c }),

  startEdit: (c) => set({ editingCompanion: c, isCreating: false }),

  startCreate: () => set({ editingCompanion: null, isCreating: true }),

  closeEdit: () => set({ editingCompanion: null, isCreating: false }),

  save: async (form) => {
    const { isCreating, editingCompanion } = get()
    if (isCreating) {
      await window.sophia.companions.create(form)
    } else if (editingCompanion) {
      await window.sophia.companions.update(editingCompanion.id, form)
    }
    set({ editingCompanion: null, isCreating: false })
    await get().fetch()
  },

  remove: async () => {
    const { editingCompanion } = get()
    if (!editingCompanion) return
    await window.sophia.companions.delete(editingCompanion.id)
    set({ editingCompanion: null, isCreating: false })
    await get().fetch()
  },
}))
