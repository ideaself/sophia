import { z } from 'zod'
import { ArtifactType, TextbookFormat } from '../types/ids'

// --- Shared ---

/**
 * Domain ids double as file/directory names in the data root. Restricting
 * them to plain path segments prevents a compromised renderer from
 * smuggling path traversal (e.g. "../../config") through IPC into storage
 * paths, where ids are joined directly.
 */
export const EntityIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid id')

/** All artifact types the pipeline may generate (derived from ArtifactType). */
export const IpcArtifactTypeSchema = z.enum(ArtifactType)

// --- IPC: Companion ---

// --- IPC: Conversation ---

export const IpcCreateConversationInputSchema = z.object({
  companionId: EntityIdSchema,
  companionVersion: z.number().int().min(1).optional(),
  textbookId: EntityIdSchema.optional(),
  title: z.string().min(1)
})

// --- IPC: Message ---

export const IpcSearchMessagesInputSchema = z.object({
  query: z.string().min(2),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional()
})

// --- IPC: Conversation (additional) ---

export const IpcUpdateTitleInputSchema = z.object({
  conversationId: EntityIdSchema,
  title: z.string().min(1),
})

export const IpcEndClassInputSchema = z.object({
  conversationId: EntityIdSchema,
  classMode: z.enum(['standard', 'feynman']).optional()
})

export const IpcRedoArtifactsInputSchema = z.object({
  conversationId: EntityIdSchema,
  types: z.array(IpcArtifactTypeSchema).min(1)
})

export const IpcTruncateConversationInputSchema = z.object({
  conversationId: EntityIdSchema,
  messageId: EntityIdSchema,
})

export const IpcTextbookSearchExcerptInputSchema = z.object({
  textbookId: EntityIdSchema,
  chapter: z.string().min(1),
})

export const IpcTextbookTranslateExcerptInputSchema = z.object({
  textbookId: EntityIdSchema,
  chapter: z.string().min(1),
})

export const IpcGetConversationInputSchema = z.object({
  conversationId: EntityIdSchema,
})

export const IpcDeleteConversationInputSchema = z.object({
  conversationId: EntityIdSchema,
})

// --- IPC: Message (additional) ---

export const IpcSendMessageInputSchema = z.object({
  conversationId: EntityIdSchema,
  // trim: whitespace-only content would persist as a line that the read-side
  // MessageSchema (trim + min 1) then silently drops.
  content: z.string().trim().min(1),
  role: z.enum(['user', 'assistant', 'system']).optional(),
})

export const IpcGetMessagesInputSchema = z.object({
  conversationId: EntityIdSchema,
})

export const IpcUpdateMessageInputSchema = z.object({
  conversationId: EntityIdSchema,
  messageId: EntityIdSchema,
  content: z.string().trim().min(1),
})

export const IpcDeleteMessageInputSchema = z.object({
  conversationId: EntityIdSchema,
  messageId: EntityIdSchema,
})

// --- IPC: Artifact (additional) ---

export const IpcCreateArtifactInputSchema = z.object({
  conversationId: EntityIdSchema,
  type: IpcArtifactTypeSchema,
  content: z.string()
})

export const IpcGetArtifactInputSchema = z.object({
  artifactId: EntityIdSchema,
  conversationId: EntityIdSchema,
})

export const IpcUpdateArtifactInputSchema = z.object({
  artifactId: EntityIdSchema,
  conversationId: EntityIdSchema,
  content: z.string().min(1),
})

export const IpcListArtifactsInputSchema = z.object({
  conversationId: EntityIdSchema,
})

// --- IPC: Flashcard (additional) ---

/** One card to delete, identified by its artifact + index within it. */
export const IpcFlashcardRefSchema = z.object({
  conversationId: EntityIdSchema,
  artifactId: EntityIdSchema,
  cardIndex: z.number().int().min(0)
})

export const IpcFlashcardDeleteCardsInputSchema = z.object({
  cards: z.array(IpcFlashcardRefSchema).min(1),
})

/** Hard cap so a runaway renderer cannot write arbitrarily large state files. */
const MAX_FLASHCARD_STATE_BYTES = 2 * 1024 * 1024

/**
 * SRS state is an opaque map keyed by card key. Shape-checked (plain object)
 * and size-capped; undefined/oversized payloads are rejected at the boundary.
 */
export const IpcFlashcardSrsStateInputSchema = z
  .record(z.string().max(512), z.unknown())
  .refine(
    (value) => JSON.stringify(value).length <= MAX_FLASHCARD_STATE_BYTES,
    { message: 'SRS state payload too large' }
  )

/** Favorite card keys (bounded strings, bounded count). */
export const IpcFlashcardFavoritesInputSchema = z
  .array(z.string().min(1).max(512))
  .max(20_000)

// --- IPC: Archive (回收站) ---

export const IpcArchiveEntryIdInputSchema = z.object({
  entryId: EntityIdSchema
})

// --- IPC: PDF export (课堂记录/笔记导出) ---

export const IpcPdfExportInputSchema = z.object({
  html: z.string(),
  filePath: z.string().min(1)
})

// --- IPC: Screenshot (截图) ---

export const IpcScreenshotInputSchema = z.object({
  filePath: z.string().min(1)
})

// --- IPC: AI 代答 (3.2.0 Ctrl+Shift+A) ---

export const IpcAiComposeInputSchema = z.object({
  question: z.string(),
  history: z.string().optional().default('')
})

// --- IPC: EPUB 内容重新提取（导入时正文为空时修复用） ---

export const IpcReparseEpubInputSchema = z.object({
  textbookId: EntityIdSchema,
})

// --- IPC: Profile lock (档案锁) ---

export const IpcLockSetInputSchema = z.object({
  pin: z.string().min(4).max(20)
})

export const IpcLockVerifyInputSchema = z.object({
  pin: z.string().min(1).max(50)
})

// --- IPC: Textbook (additional) ---

export const IpcCreateTextbookFullInputSchema = z.object({
  title: z.string().min(1),
  author: z.string().optional(),
  description: z.string().optional(),
  format: z.enum([
    TextbookFormat.Markdown,
    TextbookFormat.Text,
    TextbookFormat.Pdf,
    TextbookFormat.Epub
  ]),
  sourceFile: z.string().optional(),
  content: z.string().optional()
})

export const IpcGetTextbookInputSchema = z.object({
  textbookId: EntityIdSchema,
})

export const IpcUpdateTextbookInputSchema = z.object({
  textbookId: EntityIdSchema,
  title: z.string().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  rating: z.number().min(0).max(5).optional()
})

export const IpcUpdateTextbookProgressInputSchema = z.object({
  textbookId: EntityIdSchema,
  currentPage: z.number().int().min(0).optional(),
  totalPages: z.number().int().min(0).nullable().optional(),
  readingPercentage: z.number().min(0).max(1).optional(),
  lastPosition: z.string().optional()
})

export const IpcDeleteTextbookInputSchema = z.object({
  textbookId: EntityIdSchema,
})

export const IpcReadOriginalInputSchema = z.object({
  textbookId: EntityIdSchema,
})

export const IpcReadEpubChaptersInputSchema = z.object({
  textbookId: EntityIdSchema,
})

// --- IPC: Reading Note ---

export const IpcCreateReadingNoteInputSchema = z.object({
  textbookId: EntityIdSchema,
  content: z.string(),
  position: z.string(),
  chapter: z.string().optional(),
  type: z.enum(['highlight', 'underline', 'note', 'bookmark']).optional(),
  color: z.string().optional(),
  readerNote: z.string().optional()
})

export const IpcListReadingNotesInputSchema = z.object({
  textbookId: EntityIdSchema,
})

export const IpcUpdateReadingNoteInputSchema = z.object({
  noteId: EntityIdSchema,
  textbookId: EntityIdSchema,
  // Explicit whitelist: unknown keys are stripped instead of flowing into
  // the note record via a catchall.
  content: z.string().optional(),
  position: z.string().optional(),
  chapter: z.string().optional(),
  type: z.enum(['highlight', 'underline', 'note', 'bookmark']).optional(),
  color: z.string().optional(),
  readerNote: z.string().optional()
})

export const IpcDeleteReadingNoteInputSchema = z.object({
  noteId: EntityIdSchema,
  textbookId: EntityIdSchema,
})

// --- IPC: File I/O ---

export const IpcWriteTextFileInputSchema = z.object({
  filePath: z.string().min(1),
  content: z.string()
})

export const IpcExportBackupInputSchema = z.object({
  filePath: z.string().min(1)
})

/** Restore source path — must come from the open dialog (checked via picked-files). */
export const IpcRestoreBackupInputSchema = z.string().min(1).max(4096)

/** Concept list query: a conversation id, or '' for all concepts. */
export const IpcConceptsListInputSchema = z.union([EntityIdSchema, z.literal('')])

/** 为当前会话的薄弱概念生成记忆卡片。 */
export const IpcGenerateConceptCardsInputSchema = z.object({
  conversationId: EntityIdSchema
})

/** 概念间隔复习的一次自评。 */
export const IpcReviewConceptInputSchema = z.object({
  conceptId: EntityIdSchema,
  textbookId: EntityIdSchema.nullable(),
  rating: z.enum(['again', 'hard', 'good', 'easy'])
})

export const IpcDialogFileFiltersSchema = z.array(z.object({
  name: z.string(),
  extensions: z.array(z.string())
}))

export const IpcOpenFileDialogInputSchema = z.object({
  filters: IpcDialogFileFiltersSchema.optional()
}).optional()

export const IpcSaveFileDialogInputSchema = z.object({
  defaultPath: z.string().optional(),
  filters: IpcDialogFileFiltersSchema.optional()
}).optional()

export const IpcConfirmDialogInputSchema = z.object({
  message: z.string().min(1),
  confirmLabel: z.string().min(1).optional(),
  cancelLabel: z.string().min(1).optional()
})

// --- IPC: Chat Prompt ---

export const IpcChatPromptMessagesInputSchema = z.object({
  conversationId: EntityIdSchema,
  companionId: EntityIdSchema,
  textbookId: z.string().nullable().optional(),
  userMessage: z.string().min(1),
  classMode: z.enum(['standard', 'feynman']).optional(),
  hideNarration: z.boolean().optional(),
  pace: z.enum(['slow', 'normal', 'fast']).optional()
})

// --- IPC: Diary ---

export const IpcDiaryListMonthsInputSchema = z.object({
})

export const IpcDiaryGetMonthInputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format')
})

// --- IPC: Settings / API Key ---

export const IpcSetDeepSeekKeyInputSchema = z.object({
  key: z.string().min(1, 'API key must not be empty').trim()
})

// --- IPC: WebDAV Sync ---

/** Non-secret connection fields; the password is stored encrypted in the main process. */
export const IpcWebDavConfigInputSchema = z.object({
  url: z.string().min(1).trim(),
  username: z.string().min(1).trim()
})

export const IpcSetWebDavPasswordInputSchema = z.object({
  password: z.string().min(1, 'Password must not be empty')
})

// --- IPC: API Providers ---

export const ApiProviderTypeSchema = z.enum(['deepseek', 'mimo', 'custom'])

/**
 * Any endpoint that receives an API key must use HTTPS. Parsed with `new
 * URL` so mixed-case schemes ("HTTP://…") cannot bypass the check.
 */
export const ProviderBaseUrlSchema = z
  .string()
  .min(1, 'Base URL must not be empty')
  .max(2048)
  .refine(
    (url) => {
      try {
        return new URL(url).protocol === 'https:'
      } catch {
        return false
      }
    },
    { message: 'Endpoint must use HTTPS' }
  )

export const IpcProviderIdInputSchema = z.object({
  id: EntityIdSchema
})

export const IpcProviderCreateInputSchema = z.object({
  name: z.string().min(1).max(100),
  type: ApiProviderTypeSchema,
  baseUrl: ProviderBaseUrlSchema,
  // May be empty: providers can be created first and given a key later.
  apiKey: z.string().max(4096),
  models: z.array(z.string()).optional(),
  selectedModel: z.string().optional()
})

export const IpcProviderUpdateInputSchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1).max(100).optional(),
  type: ApiProviderTypeSchema.optional(),
  baseUrl: ProviderBaseUrlSchema.optional(),
  models: z.array(z.string()).optional(),
  selectedModel: z.string().optional(),
  isActive: z.boolean().optional()
})

export const IpcProviderSetApiKeyInputSchema = z.object({
  id: EntityIdSchema,
  apiKey: z.string().min(1)
})

export const IpcProviderEndpointInputSchema = z.object({
  baseUrl: ProviderBaseUrlSchema,
  apiKey: z.string().min(1)
})
