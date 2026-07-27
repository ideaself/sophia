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
    format: 'markdown' | 'text' | 'pdf' | 'epub'
    sourceFile: string
    content: string
    progress: { currentPage: number; totalPages: number | null }
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
  }

  interface CompanionAPI {
    list: () => Promise<CompanionDTO[]>
    get: (companionId: string) => Promise<CompanionDTO | null>
  }

  interface DialogAPI {
    openFile: (options?: {
      filters?: Array<{ name: string; extensions: string[] }>
    }) => Promise<{ canceled: boolean; filePaths: string[] }>
  }

  interface SophiaAPI {
    getVersion: () => Promise<string>
    getPlatform: () => Promise<string>
    settings: SettingsAPI
    chat: ChatAPI
    data: DataAPI
    companions: CompanionAPI
    dialog: DialogAPI
  }

  interface Window {
    sophia: SophiaAPI
  }
}
