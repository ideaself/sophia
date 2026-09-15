import { create } from 'zustand'
import type { ActiveConversation } from '../types/models'

interface ConversationStore {
  activeConversations: ActiveConversation[]
  fetchActive: () => Promise<void>
}

export const useConversationStore = create<ConversationStore>((set) => ({
  activeConversations: [],

  fetchActive: async () => {
    try {
      const convs = await window.sophia.data.listConversations()
      const active = convs.filter((c) => !c.endedAt)

      // Batch + dedupe lookups: conversations commonly share companions and
      // textbooks, and the old per-conversation loop issued them serially.
      const companionIds = [...new Set(active.map((c) => c.companionId))]
      const textbookIds = [
        ...new Set(active.map((c) => c.textbookId).filter((id): id is string => !!id))
      ]

      const [companions, textbooks] = await Promise.all([
        Promise.all(
          companionIds.map(async (id) => {
            try {
              return [id, await window.sophia.companions.get(id)] as const
            } catch {
              return [id, null] as const
            }
          })
        ),
        Promise.all(
          textbookIds.map(async (id) => {
            try {
              return [id, await window.sophia.data.getTextbook(id)] as const
            } catch {
              return [id, null] as const
            }
          })
        )
      ])

      const companionMap = new Map(companions)
      const textbookMap = new Map(textbooks)

      const enriched: ActiveConversation[] = active.map((c) => ({
        id: c.id,
        companionId: c.companionId,
        companionName: companionMap.get(c.companionId)?.name ?? '未知角色',
        textbookId: c.textbookId,
        textbookTitle: c.textbookId ? textbookMap.get(c.textbookId)?.title ?? null : null,
        title: c.title,
        updatedAt: c.updatedAt
      }))
      set({ activeConversations: enriched })
    } catch {
      set({ activeConversations: [] })
    }
  },
}))
