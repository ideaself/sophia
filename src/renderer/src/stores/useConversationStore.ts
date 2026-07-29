import { create } from 'zustand'
import type { ActiveConversation } from '../types/models'
import { WORLD_ID } from '../types/models'

interface ConversationStore {
  activeConversations: ActiveConversation[]
  fetchActive: () => Promise<void>
}

export const useConversationStore = create<ConversationStore>((set) => ({
  activeConversations: [],

  fetchActive: async () => {
    try {
      const convs = await window.sophia.data.listConversations(WORLD_ID)
      const active = convs.filter((c) => !c.endedAt)
      const enriched: ActiveConversation[] = []
      for (const c of active) {
        try {
          const comp = await window.sophia.companions.get(c.companionId)
          let tbTitle: string | null = null
          if (c.textbookId) {
            const tb = await window.sophia.data.getTextbook(c.textbookId)
            tbTitle = tb?.title ?? null
          }
          enriched.push({
            id: c.id, companionId: c.companionId, companionName: comp?.name ?? '未知角色',
            textbookId: c.textbookId, textbookTitle: tbTitle, title: c.title, updatedAt: c.updatedAt
          })
        } catch {
          enriched.push({
            id: c.id, companionId: c.companionId, companionName: '未知角色',
            textbookId: c.textbookId, textbookTitle: null, title: c.title, updatedAt: c.updatedAt
          })
        }
      }
      set({ activeConversations: enriched })
    } catch {
      set({ activeConversations: [] })
    }
  },
}))
