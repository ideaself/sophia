import { create } from 'zustand'
import type { AppView } from '../types/models'

interface AppState {
  view: AppView
  showClassroomDropdown: boolean
  loadConversationId: string | null
  classroomResetKey: number
  flashcardScope: { conversationId: string; title: string } | null
  reviewScope: { conversationId: string; title: string } | null
  setView: (v: AppView) => void
  setShowClassroomDropdown: (v: boolean) => void
  setLoadConversationId: (id: string | null) => void
  incrementResetKey: () => void
  setFlashcardScope: (scope: { conversationId: string; title: string } | null) => void
  setReviewScope: (scope: { conversationId: string; title: string } | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'classroom',
  showClassroomDropdown: false,
  loadConversationId: null,
  classroomResetKey: 0,
  flashcardScope: null,
  reviewScope: null,
  setView: (view) => set({ view }),
  setShowClassroomDropdown: (showClassroomDropdown) => set({ showClassroomDropdown }),
  setLoadConversationId: (loadConversationId) => set({ loadConversationId }),
  incrementResetKey: () => set((s) => ({ classroomResetKey: s.classroomResetKey + 1 })),
  setFlashcardScope: (flashcardScope) => set({ flashcardScope }),
  setReviewScope: (reviewScope) => set({ reviewScope }),
}))
