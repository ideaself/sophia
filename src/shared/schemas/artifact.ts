import { z } from 'zod'
import type { ArtifactId, ConversationId } from '../types/ids'
import { ArtifactType } from '../types/ids'

// Derive from the single source of truth (ArtifactType) so every artifact
// type the pipeline can generate is also readable back. A previous hand-kept
// list silently dropped lesson_audio / lesson_timeline / lesson_faq on read.
const artifactTypeSchema = z.enum(ArtifactType)

export interface Artifact {
  id: ArtifactId
  conversationId: ConversationId
  type: z.infer<typeof artifactTypeSchema>
  content: string
  createdAt: string
}

const isoDatetime = z.string().datetime({ offset: true })

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  type: artifactTypeSchema,
  content: z.string().min(1),
  createdAt: isoDatetime
})
