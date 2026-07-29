import { z } from 'zod'
import type { TextbookId, WorldId } from '../types/ids'
import { TextbookFormat } from '../types/ids'

export interface Textbook {
  id: TextbookId
  worldId: WorldId
  title: string
  author: string
  description: string
  format: z.infer<typeof textbookFormatSchema>
  sourceFile: string
  originalFile: string
  content: string
  fileHash: string
  progress: { currentPage: number; totalPages: number | null; readingPercentage: number; lastPosition: string }
  rating: number
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

const textbookFormatSchema = z.enum([
  TextbookFormat.Markdown,
  TextbookFormat.Text,
  TextbookFormat.Pdf,
  TextbookFormat.Epub
])

const progressSchema = z.object({
  currentPage: z.number().int().min(0),
  totalPages: z.number().int().min(0).nullable(),
  readingPercentage: z.number().min(0).max(1).default(0),
  lastPosition: z.string().default('')
})

const isoDatetime = z.string().datetime({ offset: true })

export const TextbookSchema = z.object({
  id: z.string().min(1),
  worldId: z.string().min(1),
  title: z.string().min(1),
  author: z.string().default(''),
  description: z.string().default(''),
  format: textbookFormatSchema,
  sourceFile: z.string(),
  originalFile: z.string().default(''),
  content: z.string().default(''),
  fileHash: z.string().default(''),
  progress: progressSchema.default({ currentPage: 0, totalPages: null, readingPercentage: 0, lastPosition: '' }),
  rating: z.number().min(0).max(5).default(0),
  isDeleted: z.boolean().default(false),
  createdAt: isoDatetime,
  updatedAt: isoDatetime
})
