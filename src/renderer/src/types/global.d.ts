import type { ArtifactType } from '../../../shared/types/ids'
import type { UpdaterCheckResult } from '../../../shared/updater'

export {}

declare global {
  // Electron <webview> custom element (dictionary popup). Not part of the
  // standard DOM/JSX intrinsic elements.
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        webpreferences?: string
        partition?: string
        allowpopups?: string
      }
    }
  }

  interface ChatAPI {
    startStream: (
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      model?: string,
      thinking?: boolean
    ) => Promise<string>
    cancelStream: (sessionId: string) => Promise<void>
    onToken: (sessionId: string, callback: (token: string) => void) => () => void
    onThinking: (sessionId: string, callback: (text: string) => void) => () => void
    onError: (sessionId: string, callback: (error: { code: string; message: string }) => void) => () => void
    onEnd: (sessionId: string, callback: (finishReason: string) => void) => () => void
    onUsage: (sessionId: string, callback: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void) => () => void
    getPromptMessages: (input: {
      conversationId: string
      companionId: string
      textbookId?: string | null
      userMessage: string
      classMode?: 'standard' | 'feynman'
      hideNarration?: boolean
      pace?: 'slow' | 'normal' | 'fast'
    }) => Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>>
  }

  interface SettingsAPI {
    hasDeepSeekKey: () => Promise<boolean>
    setDeepSeekKey: (key: string) => Promise<void>
    deleteDeepSeekKey: () => Promise<void>
  }

  interface ConversationDTO {
    id: string
    companionId: string
    companionVersion: number | null
    textbookId: string | null
    title: string
    createdAt: string
    updatedAt: string
    endedAt: string | null
  }

  interface MessageDTO {
    id: string
    conversationId: string
    role: 'user' | 'assistant' | 'system'
    content: string
    createdAt: string
  }

  interface TextbookDTO {
    id: string
    title: string
    author: string
    description: string
    format: 'markdown' | 'text' | 'pdf' | 'epub'
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

  interface ReadingNoteDTO {
    id: string
    textbookId: string
    content: string
    position: string
    chapter: string
    type: 'highlight' | 'underline' | 'note' | 'bookmark'
    color: string
    readerNote: string
    createdAt: string
    updatedAt: string
  }

  interface ArtifactDTO {
    id: string
    conversationId: string
    type: ArtifactType
    content: string
    createdAt: string
  }

  interface ArtifactsGeneratedPayload {
    conversationId: string
    artifacts: number
    farewell: string
    failures: string[]
    error?: string
  }

  interface ConceptStateDTO {
    id: string
    name: string
    textbookId: string | null
    mastery: number
    misconception: string | null
    attemptCount: number
    correctCount: number
    lastSeenAt: string
    updatedAt: string
    evidenceConversationId: string
    evidenceConversationIds?: string[]
    evidenceMessageIds: string[]
    /** 间隔复习排期（SM-2，数据版本 2 起；旧数据读取时补齐）。 */
    srs?: {
      interval: number
      ease: number
      reps: number
      nextReview: number
      lastReview: number
    }
  }

  interface SearchResultDTO {
    conversationId: string
    message: MessageDTO
  }

  interface StatsOverviewDTO {
    messageCounts: Record<string, number>
    artifactCounts: Record<string, number>
    totalMessages: number
    totalArtifacts: number
    /** dayKey (YYYY-MM-DD) → estimated study milliseconds. */
    dailyMinutes: Record<string, number>
    week: {
      startKey: string
      ms: number
      messages: number
      artifacts: number
      companion: Record<string, number>
      textbook: Record<string, number>
    }
  }

  interface EpubChaptersResult {
    chapters: Array<{ id: string; title: string; html: string }>
    title: string
    author: string
  }

  interface CompanionDTO {
    id: string
    source: string
    version: number
    name: string
    gender: string
    age: number
    identity: string
    personalityKeywords: string[]
    personality: string
    speakingStyle: string
    emotionalExpressions: string
    originalFile: string
  }

  interface DataAPI {
    writeTextFile: (filePath: string, content: string) => Promise<{ success: boolean }>
    exportBackup: (filePath: string) => Promise<{ fileCount: number }>
    restoreBackup: (zipPath: string) => Promise<{ success: boolean; preRestore?: string; error?: string }>
    createConversation: (input: {
      companionId: string
      companionVersion?: number
      textbookId?: string
      title: string
    }) => Promise<ConversationDTO>
    getConversation: (conversationId: string) => Promise<ConversationDTO | null>
    listConversations: () => Promise<ConversationDTO[]>
    deleteConversation: (conversationId: string) => Promise<boolean>
    updateTitle: (conversationId: string, title: string) => Promise<ConversationDTO | null>
    truncateConversation: (conversationId: string, messageId: string) => Promise<boolean>
    sendMessage: (input: {
      conversationId: string
      content: string
      role?: string
    }) => Promise<MessageDTO>
    updateMessage: (conversationId: string, messageId: string, content: string) => Promise<MessageDTO | null>
    deleteMessage: (conversationId: string, messageId: string) => Promise<boolean>
    listMessages: (conversationId: string) => Promise<MessageDTO[]>
    searchMessages: (query: string, limit?: number, offset?: number) => Promise<{ results: SearchResultDTO[]; total: number }>
    todayStudyMinutes: () => Promise<number>
    dueFlashcardCount: () => Promise<{ due: number; total: number }>
    statsOverview: () => Promise<StatsOverviewDTO | null>
    endConversation: (conversationId: string, classMode?: 'standard' | 'feynman') => Promise<{ success: boolean; artifacts: number; farewell?: string; failures: string[]; pending: boolean }>
    redoArtifacts: (conversationId: string, types: string[]) => Promise<{ success: boolean; artifacts: number; types: string[]; failures: string[] }>
    onArtifactsGenerated: (callback: (payload: ArtifactsGeneratedPayload) => void) => () => void
    listConcepts: (conversationId: string) => Promise<ConceptStateDTO[]>
    onConceptsUpdated: (callback: (payload: { conversationId: string }) => void) => () => void
    generateConceptCards: (conversationId: string) => Promise<{
      success: boolean
      added: number
      concepts?: string[]
      error?: string
    }>
    reviewConcept: (
      conceptId: string,
      textbookId: string | null,
      rating: 'again' | 'hard' | 'good' | 'easy'
    ) => Promise<ConceptStateDTO | null>
    dueConceptCount: () => Promise<{ due: number; total: number }>
    createTextbook: (input: {
      title: string
      format: 'markdown' | 'text' | 'pdf' | 'epub'
      sourceFile?: string
      content?: string
    }) => Promise<TextbookDTO>
    getTextbook: (textbookId: string) => Promise<TextbookDTO | null>
    readTextbookOriginal: (textbookId: string) => Promise<{ data: Uint8Array; fileName: string } | null>
    readEpubChapters: (textbookId: string) => Promise<EpubChaptersResult>
    searchTextbookExcerpt: (textbookId: string, chapter: string) => Promise<{ chapter: string; excerpt: string } | null>
    translateTextbookExcerpt: (textbookId: string, chapter: string) => Promise<{ chapter: string; excerpt: string; translation: string } | null>
    listTextbooks: () => Promise<TextbookDTO[]>
    updateTextbook: (textbookId: string, updates: { title?: string; content?: string }) => Promise<TextbookDTO | null>
    deleteTextbook: (textbookId: string) => Promise<boolean>
    createArtifact: (input: {
      conversationId: string
      // Single source of truth for artifact kinds (shared/types/ids).
      type: ArtifactType
      content: string
    }) => Promise<ArtifactDTO>
    getArtifact: (artifactId: string, conversationId: string) => Promise<ArtifactDTO | null>
    updateArtifact: (artifactId: string, conversationId: string, content: string) => Promise<ArtifactDTO | null>
    listArtifacts: (conversationId: string) => Promise<ArtifactDTO[]>
    updateTextbookProgress: (textbookId: string, progress: { currentPage?: number; totalPages?: number | null; readingPercentage?: number; lastPosition?: string }) => Promise<TextbookDTO | null>
    createReadingNote: (input: {
      textbookId: string
      content: string
      position: string
      chapter?: string
      type?: 'highlight' | 'underline' | 'note' | 'bookmark'
      color?: string
      readerNote?: string
    }) => Promise<ReadingNoteDTO>
    listReadingNotes: (textbookId: string) => Promise<ReadingNoteDTO[]>
    updateReadingNote: (noteId: string, textbookId: string, updates: Record<string, unknown>) => Promise<ReadingNoteDTO | null>
    deleteReadingNote: (noteId: string, textbookId: string) => Promise<boolean>
    getFlashcardSrsState: () => Promise<Record<string, unknown>>
    saveFlashcardSrsState: (state: Record<string, unknown>) => Promise<{ success: boolean }>
    getFlashcardFavorites: () => Promise<string[]>
    saveFlashcardFavorites: (ids: string[]) => Promise<{ success: boolean }>
    deleteFlashcardCards: (cards: Array<{ conversationId: string; artifactId: string; cardIndex: number }>) => Promise<{ success: boolean; deleted: number }>
    archive: {
      list: () => Promise<Array<{ id: string; kind: string; label: string; movedAt: string }>>
      restore: (entryId: string) => Promise<{ success: boolean }>
      purge: (entryId: string) => Promise<{ success: boolean }>
    },
    lock: {
      has: () => Promise<boolean>
      set: (pin: string) => Promise<{ success: boolean }>
      verify: (pin: string) => Promise<boolean>
      clear: () => Promise<{ success: boolean }>
    },
    exportPdf: (html: string, filePath: string) => Promise<{ success: boolean }>
    captureScreenshot: (filePath: string) => Promise<{ success: boolean }>
    composeAiAnswer: (question: string, history: string) => Promise<{ content: string }>
    reparseEpubContent: (textbookId: string) => Promise<{ success: boolean; content: string }>
    diary: {
      listMonths: () => Promise<string[]>
      getMonth: (month: string) => Promise<string | null>
    }
  }

  interface CompanionAPI {
    list: () => Promise<CompanionDTO[]>
    get: (companionId: string) => Promise<CompanionDTO | null>
    create: (input: {
      name: string
      gender: string
      age: number
      identity: string
      personalityKeywords: string[]
      personality: string
      speakingStyle: string
      emotionalExpressions: string
    }) => Promise<CompanionDTO>
    update: (companionId: string, updates: Partial<Pick<CompanionDTO, 'name' | 'gender' | 'age' | 'identity' | 'personalityKeywords' | 'personality' | 'speakingStyle' | 'emotionalExpressions'>>) => Promise<CompanionDTO | null>
    delete: (companionId: string) => Promise<boolean>
  }

  interface DialogAPI {
    openFile: (options?: {
      filters?: Array<{ name: string; extensions: string[] }>
    }) => Promise<{ canceled: boolean; filePaths: string[] }>
    saveFile: (options?: {
      defaultPath?: string
      filters?: Array<{ name: string; extensions: string[] }>
    }) => Promise<{ canceled: boolean; filePath?: string }>
    confirm: (options: {
      message: string
      confirmLabel?: string
      cancelLabel?: string
    }) => Promise<boolean>
  }

  interface ProviderDTO {
    id: string
    name: string
    type: string
    baseUrl: string
    models: string[]
    selectedModel: string
    isActive: boolean
    createdAt: string
    updatedAt: string
  }

  interface ProviderAPI {
    list: () => Promise<ProviderDTO[]>
    get: (id: string) => Promise<ProviderDTO | null>
    getActive: () => Promise<ProviderDTO | null>
    create: (input: {
      name: string
      type: string
      baseUrl: string
      apiKey: string
      models?: string[]
      selectedModel?: string
    }) => Promise<ProviderDTO>
    update: (id: string, updates: Partial<Pick<ProviderDTO, 'name' | 'type' | 'baseUrl' | 'models' | 'selectedModel' | 'isActive'>>) => Promise<ProviderDTO | null>
    delete: (id: string) => Promise<boolean>
    setActive: (id: string) => Promise<ProviderDTO | null>
    setApiKey: (id: string, apiKey: string) => Promise<void>
    hasApiKey: (id: string) => Promise<boolean>
    fetchModels: (baseUrl: string, apiKey: string) => Promise<string[]>
    testConnection: (baseUrl: string, apiKey: string) => Promise<{ success: boolean; models?: string[]; message?: string; error?: string }>
  }

  interface SyncWebDavConfig {
    url: string
    username: string
  }

  interface SyncResult {
    success: boolean
    transferred: number
    skipped: number
    deleted: number
    /** Push: files parked in the remote trash instead of deleted. */
    trashed: number
    /** Pull: local copies preserved because both sides had changed. */
    conflicts: number
    errors: string[]
    timestamp?: string
  }

  interface SyncProgress {
    direction: 'push' | 'pull'
    current: number
    total: number
    file: string
  }

  interface SyncPlanSummary {
    transferCount: number
    skipCount: number
    deleteCount: number
    deleteSample: string[]
  }

  interface SyncAPI {
    test: (config: SyncWebDavConfig) => Promise<{ success: boolean; message?: string }>
    planPush: (config: SyncWebDavConfig) => Promise<SyncPlanSummary>
    planPull: (config: SyncWebDavConfig) => Promise<SyncPlanSummary>
    push: (config: SyncWebDavConfig) => Promise<SyncResult>
    pull: (config: SyncWebDavConfig) => Promise<SyncResult>
    listTrash: (config: SyncWebDavConfig) => Promise<{
      batches: Array<{ name: string; fileCount: number; totalSize: number }>
      fileCount: number
      totalSize: number
    }>
    emptyTrash: (config: SyncWebDavConfig) => Promise<{ success: boolean; deletedBatches: number }>
    hasWebdavPassword: () => Promise<boolean>
    setWebdavPassword: (password: string) => Promise<void>
    onProgress: (callback: (progress: SyncProgress) => void) => () => void
  }

  interface AppAPI {
    minimizeToTray: () => Promise<void>
    openExternal: (url: string) => Promise<{ success: boolean }>
    openDataDir: () => Promise<{ success: boolean; error?: string }>
    onDictFrameBlocked: (callback: (payload: { url: string }) => void) => () => void
  }

  interface UpdaterAPI {
    /** Manual update check (设置页「检查更新」); background updates are separate. */
    checkForUpdates: () => Promise<UpdaterCheckResult>
  }

  interface SophiaAPI {
    getVersion: () => Promise<string>
    getPlatform: () => Promise<string>
    app: AppAPI
    settings: SettingsAPI
    chat: ChatAPI
    data: DataAPI
    companions: CompanionAPI
    dialog: DialogAPI
    providers: ProviderAPI
    sync: SyncAPI
    updater: UpdaterAPI
  }

  interface Window {
    sophia: SophiaAPI
  }
}
