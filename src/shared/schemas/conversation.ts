import { z } from 'zod'
import type { ConversationId, CompanionId, TextbookId } from '../types/ids'

export interface Conversation {
  id: ConversationId
  companionId: CompanionId
  /** 会话创建时的人格版本快照（里程碑 2）：改角色不回溯旧会话。 */
  companionVersion: number | null
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
  companionVersion: z.number().int().min(1).nullable().default(null),
  textbookId: z.string().nullable(),
  title: z.string().min(1),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
  endedAt: isoDatetime.nullable()
})
