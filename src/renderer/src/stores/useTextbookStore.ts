import { create } from 'zustand'
import type { Textbook } from '../types/models'
import { WORLD_ID } from '../types/models'

interface TextbookStore {
  textbooks: Textbook[]
  selectedTextbook: Textbook | null
  fetch: () => Promise<void>
  select: (t: Textbook | null) => void
}

export const useTextbookStore = create<TextbookStore>((set) => ({
  textbooks: [],
  selectedTextbook: null,

  fetch: async () => {
    const list = await window.sophia.data.listTextbooks(WORLD_ID)
    set({ textbooks: list })
  },

  select: (t) => set({ selectedTextbook: t }),
}))
