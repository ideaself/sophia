import { z } from 'zod'
import { TextbookFormat } from '../types/ids'

// --- IPC: Companion ---

// --- IPC: Textbook ---

export const IpcCreateTextbookInputSchema = z.object({
  title: z.string().min(1),
  format: z.enum([
    TextbookFormat.Markdown,
    TextbookFormat.Text,
    TextbookFormat.Pdf,
    TextbookFormat.Epub
  ]),
  sourceFile: z.string().optional().default(''),
  content: z.string().optional()
})

export const IpcUpdateTextbookContentInputSchema = z.object({
  textbookId: z.string().min(1),
  content: z.string().min(1)
})

// --- IPC: Conversation ---

export const IpcCreateConversationInputSchema = z.object({
  companionId: z.string().min(1),
  textbookId: z.string().optional(),
  title: z.string().min(1)
})

export const IpcListConversationsInputSchema = z.object({
})

// --- IPC: Message ---

export const IpcSearchMessagesInputSchema = z.object({
  query: z.string().min(2),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional()
})

// --- IPC: Conversation (additional) ---

export const IpcUpdateTitleInputSchema = z.object({
  conversationId: z.string().min(1),
  title: z.string().min(1),
})

export const IpcEndClassInputSchema = z.object({
  conversationId: z.string().min(1),
  classMode: z.enum(['standard', 'feynman']).optional()
})

export const IpcRedoArtifactsInputSchema = z.object({
  conversationId: z.string().min(1),
  types: z.array(z.string().min(1)).min(1)
})

export const IpcTruncateConversationInputSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
})

export const IpcTextbookSearchExcerptInputSchema = z.object({
  textbookId: z.string().min(1),
  chapter: z.string().min(1),
})

export const IpcTextbookTranslateExcerptInputSchema = z.object({
  textbookId: z.string().min(1),
  chapter: z.string().min(1),
})

export const IpcGetConversationInputSchema = z.object({
  conversationId: z.string().min(1),
})

export const IpcDeleteConversationInputSchema = z.object({
  conversationId: z.string().min(1),
})

// --- IPC: Message (additional) ---

export const IpcSendMessageInputSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']).optional(),
})

export const IpcGetMessagesInputSchema = z.object({
  conversationId: z.string().min(1),
})

export const IpcUpdateMessageInputSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  content: z.string(),
})

export const IpcDeleteMessageInputSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
})

// --- IPC: Artifact (additional) ---

export const IpcArtifactTypeSchema = z.enum([
  'lesson_summary', 'flashcards', 'diary', 'progress', 'handoff_tail', 'farewell', 'learner_profile', 'pal_moments', 'relation', 'companion_note'
])

export const IpcCreateArtifactInputSchema = z.object({
  conversationId: z.string().min(1),
  type: IpcArtifactTypeSchema,
  content: z.string()
})

export const IpcGetArtifactInputSchema = z.object({
  artifactId: z.string().min(1),
  conversationId: z.string().min(1),
})

export const IpcUpdateArtifactInputSchema = z.object({
  artifactId: z.string().min(1),
  conversationId: z.string().min(1),
  content: z.string().min(1),
})

export const IpcListArtifactsInputSchema = z.object({
  conversationId: z.string().min(1),
})

// --- IPC: Flashcard (additional) ---

/** One card to delete, identified by its artifact + index within it. */
export const IpcFlashcardRefSchema = z.object({
  conversationId: z.string().min(1),
  artifactId: z.string().min(1),
  cardIndex: z.number().int().min(0)
})

export const IpcFlashcardDeleteCardsInputSchema = z.object({
  cards: z.array(IpcFlashcardRefSchema).min(1),
})

// --- IPC: Archive (回收站) ---

export const IpcArchiveEntryIdInputSchema = z.object({
  entryId: z.string().min(1)
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
  textbookId: z.string().min(1),
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
  textbookId: z.string().min(1),
})

export const IpcListTextbooksInputSchema = z.object({
})

export const IpcUpdateTextbookInputSchema = z.object({
  textbookId: z.string().min(1),
  title: z.string().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  rating: z.number().min(0).max(5).optional()
})

export const IpcUpdateTextbookProgressInputSchema = z.object({
  textbookId: z.string().min(1),
  currentPage: z.number().int().min(0).optional(),
  totalPages: z.number().int().min(0).nullable().optional(),
  readingPercentage: z.number().min(0).max(1).optional(),
  lastPosition: z.string().optional()
})

export const IpcDeleteTextbookInputSchema = z.object({
  textbookId: z.string().min(1),
})

export const IpcReadOriginalInputSchema = z.object({
  textbookId: z.string().min(1),
})

export const IpcReadEpubChaptersInputSchema = z.object({
  textbookId: z.string().min(1),
})

// --- IPC: Reading Note ---

export const IpcCreateReadingNoteInputSchema = z.object({
  textbookId: z.string().min(1),
  content: z.string(),
  position: z.string(),
  chapter: z.string().optional(),
  type: z.enum(['highlight', 'underline', 'note', 'bookmark']).optional(),
  color: z.string().optional(),
  readerNote: z.string().optional()
})

export const IpcListReadingNotesInputSchema = z.object({
  textbookId: z.string().min(1),
})

export const IpcUpdateReadingNoteInputSchema = z.object({
  noteId: z.string().min(1),
  textbookId: z.string().min(1),
}).catchall(z.unknown())

export const IpcDeleteReadingNoteInputSchema = z.object({
  noteId: z.string().min(1),
  textbookId: z.string().min(1),
})

// --- IPC: File I/O ---

export const IpcWriteTextFileInputSchema = z.object({
  filePath: z.string().min(1),
  content: z.string()
})

export const IpcExportBackupInputSchema = z.object({
  filePath: z.string().min(1)
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
  conversationId: z.string().min(1),
  companionId: z.string().min(1),
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
