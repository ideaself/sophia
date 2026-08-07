import { z } from 'zod'
import type { ConversationId, CompanionId, TextbookId } from '../types/ids'

export interface Conversation {
  id: ConversationId
  companionId: CompanionId
  textbookId: TextbookId | null
  title: string
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

const isoDatetime = z.string().datetime({ offset: true })

export const ConversationSchema = z.object({
  id: z.string().min(1),
  companionId: z.string().min(1),
  textbookId: z.string().nullable(),
  title: z.string().min(1),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
  endedAt: isoDatetime.nullable()
})
