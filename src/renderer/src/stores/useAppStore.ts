import { create } from 'zustand'
import type { AppView, Companion } from '../types/models'

interface AppState {
  view: AppView
  showClassroomDropdown: boolean
  loadConversationId: string | null
  classroomResetKey: number
  /** 每次「新建课堂」递增 —— 让 ClassroomView 重挂载时以全新空白标签页启动。 */
  freshClassroomNonce: number
  /** 新建课堂弹窗（选角色 → 选教材）。 */
  newClassroomOpen: boolean
  newClassroomPreselect: Companion | null
  flashcardScope: { conversationId: string; title: string } | null
  reviewScope: { conversationId: string; title: string } | null
  setView: (v: AppView) => void
  setShowClassroomDropdown: (v: boolean) => void
  setLoadConversationId: (id: string | null) => void
  beginNewClassroom: () => void
  setNewClassroomOpen: (open: boolean) => void
  setNewClassroomPreselect: (c: Companion | null) => void
  setFlashcardScope: (scope: { conversationId: string; title: string } | null) => void
  setReviewScope: (scope: { conversationId: string; title: string } | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'classroom',
  showClassroomDropdown: false,
  loadConversationId: null,
  classroomResetKey: 0,
  freshClassroomNonce: 0,
  newClassroomOpen: false,
  newClassroomPreselect: null,
  flashcardScope: null,
  reviewScope: null,
  setView: (view) => set({ view }),
  setShowClassroomDropdown: (showClassroomDropdown) => set({ showClassroomDropdown }),
  setLoadConversationId: (loadConversationId) => set({ loadConversationId }),
  beginNewClassroom: () => set((s) => ({
    classroomResetKey: s.classroomResetKey + 1,
    freshClassroomNonce: s.freshClassroomNonce + 1
  })),
  setNewClassroomOpen: (newClassroomOpen) => set({ newClassroomOpen }),
  setNewClassroomPreselect: (newClassroomPreselect) => set({ newClassroomPreselect }),
  setFlashcardScope: (flashcardScope) => set({ flashcardScope }),
  setReviewScope: (reviewScope) => set({ reviewScope }),
}))
