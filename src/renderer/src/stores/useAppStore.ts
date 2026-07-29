import { create } from 'zustand'
import type { AppView } from '../types/models'

interface AppState {
  view: AppView
  showClassroomDropdown: boolean
  loadConversationId: string | null
  classroomResetKey: number
  setView: (v: AppView) => void
  setShowClassroomDropdown: (v: boolean) => void
  setLoadConversationId: (id: string | null) => void
  incrementResetKey: () => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'classroom',
  showClassroomDropdown: false,
  loadConversationId: null,
  classroomResetKey: 0,
  setView: (view) => set({ view }),
  setShowClassroomDropdown: (showClassroomDropdown) => set({ showClassroomDropdown }),
  setLoadConversationId: (loadConversationId) => set({ loadConversationId }),
  incrementResetKey: () => set((s) => ({ classroomResetKey: s.classroomResetKey + 1 })),
}))
