export {}

declare global {
  interface ChatAPI {
    startStream: (
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      model?: string
    ) => Promise<string>
    cancelStream: (sessionId: string) => Promise<void>
    onToken: (sessionId: string, callback: (token: string) => void) => () => void
    onError: (sessionId: string, callback: (error: { code: string; message: string }) => void) => () => void
    onEnd: (sessionId: string, callback: (finishReason: string) => void) => () => void
    onUsage: (sessionId: string, callback: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void) => () => void
    getPromptMessages: (input: {
      conversationId: string
      companionId: string
      textbookId?: string | null
      userMessage: string
      worldId?: string
    }) => Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>>
  }

  interface SettingsAPI {
    hasDeepSeekKey: () => Promise<boolean>
    setDeepSeekKey: (key: string) => Promise<void>
    deleteDeepSeekKey: () => Promise<void>
  }

  interface ConversationDTO {
    id: string
    worldId: string
    companionId: string
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
    worldId: string
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
    worldId: string
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
    type: 'lesson_summary' | 'flashcards' | 'diary' | 'progress' | 'handoff_tail'
    content: string
    createdAt: string
  }

interface SearchResultDTO {
  conversationId: string
  message: MessageDTO
}

interface EpubChaptersResult {
  chapters: Array<{ id: string; title: string; html: string }>
  title: string
  author: string
}

  interface CompanionDTO {
    id: string
    source: string
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
    createConversation: (input: {
      worldId: string
      companionId: string
      textbookId?: string
      title: string
    }) => Promise<ConversationDTO>
    getConversation: (conversationId: string, worldId?: string) => Promise<ConversationDTO | null>
    listConversations: (worldId: string) => Promise<ConversationDTO[]>
    deleteConversation: (conversationId: string, worldId?: string) => Promise<boolean>
    updateTitle: (conversationId: string, title: string, worldId?: string) => Promise<ConversationDTO | null>
    sendMessage: (input: {
      conversationId: string
      content: string
      role?: string
      worldId?: string
    }) => Promise<MessageDTO>
    updateMessage: (conversationId: string, messageId: string, content: string, worldId?: string) => Promise<MessageDTO | null>
    deleteMessage: (conversationId: string, messageId: string, worldId?: string) => Promise<boolean>
    listMessages: (conversationId: string, worldId?: string) => Promise<MessageDTO[]>
    searchMessages: (worldId: string, query: string) => Promise<SearchResultDTO[]>
    endConversation: (conversationId: string, worldId?: string) => Promise<{ success: boolean; artifacts: number }>
    createTextbook: (input: {
      worldId: string
      title: string
      format: 'markdown' | 'text' | 'pdf' | 'epub'
      sourceFile?: string
      content?: string
    }) => Promise<TextbookDTO>
    getTextbook: (textbookId: string, worldId?: string) => Promise<TextbookDTO | null>
    readTextbookOriginal: (textbookId: string, worldId?: string) => Promise<{ data: Uint8Array; fileName: string } | null>
    readEpubChapters: (textbookId: string, worldId?: string) => Promise<EpubChaptersResult>
    listTextbooks: (worldId: string) => Promise<TextbookDTO[]>
    updateTextbookContent: (textbookId: string, content: string, worldId?: string) => Promise<TextbookDTO | null>
    updateTextbook: (textbookId: string, updates: { title?: string; content?: string }, worldId?: string) => Promise<TextbookDTO | null>
    deleteTextbook: (textbookId: string, worldId?: string) => Promise<boolean>
    createArtifact: (input: {
      conversationId: string
      type: 'lesson_summary' | 'flashcards' | 'diary' | 'progress' | 'handoff_tail'
      content: string
      worldId?: string
    }) => Promise<ArtifactDTO>
    getArtifact: (artifactId: string, conversationId: string, worldId?: string) => Promise<ArtifactDTO | null>
    listArtifacts: (conversationId: string, worldId?: string) => Promise<ArtifactDTO[]>
    generateArtifacts: (conversationId: string, apiKey: string, worldId?: string) => Promise<{ count: number; types: string[] }>
    updateTextbookProgress: (textbookId: string, progress: { currentPage?: number; totalPages?: number | null; readingPercentage?: number; lastPosition?: string }, worldId?: string) => Promise<TextbookDTO | null>
    createReadingNote: (input: {
      textbookId: string
      worldId?: string
      content: string
      position: string
      chapter?: string
      type?: 'highlight' | 'underline' | 'note' | 'bookmark'
      color?: string
      readerNote?: string
    }) => Promise<ReadingNoteDTO>
    listReadingNotes: (textbookId: string, worldId?: string) => Promise<ReadingNoteDTO[]>
    updateReadingNote: (noteId: string, textbookId: string, updates: Record<string, unknown>, worldId?: string) => Promise<ReadingNoteDTO | null>
    deleteReadingNote: (noteId: string, textbookId: string, worldId?: string) => Promise<boolean>
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
    hasWebdavPassword: () => Promise<boolean>
    setWebdavPassword: (password: string) => Promise<void>
    onProgress: (callback: (progress: SyncProgress) => void) => () => void
  }

  interface AppAPI {
    minimizeToTray: () => Promise<void>
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
  }

  interface Window {
    sophia: SophiaAPI
  }
}
