import { contextBridge, ipcRenderer } from 'electron'
import {
  CHAT_STREAM_START,
  CHAT_STREAM_CANCEL,
  CHAT_STREAM_EVENT,
  ARTIFACTS_GENERATED
} from '../shared/channel-names'

// ---------------------------------------------------------------
// Chat stream event payload types (exposed to renderer)
// ---------------------------------------------------------------

export interface StreamErrorData {
  code: string
  message: string
}

export interface StreamUsageData {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ArtifactsGeneratedPayload {
  conversationId: string
  artifacts: number
  farewell: string
  failures: string[]
  error?: string
}

// ---------------------------------------------------------------
// Domain types (lightweight — full types come from shared/schemas)
// ---------------------------------------------------------------

export interface ConversationDTO {
  id: string
  worldId: string
  companionId: string
  textbookId: string | null
  title: string
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

export interface MessageDTO {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

export interface TextbookDTO {
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

export interface ReadingNoteDTO {
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

export interface ArtifactDTO {
  id: string
  conversationId: string
  type: 'lesson_summary' | 'flashcards' | 'diary' | 'progress' | 'handoff_tail' | 'farewell' | 'learner_profile' | 'pal_moments' | 'relation' | 'companion_note'
  content: string
  createdAt: string
}

export interface SearchResultDTO {
  conversationId: string
  message: MessageDTO
}

// ---------------------------------------------------------------
// Settings API
// ---------------------------------------------------------------

export interface SettingsAPI {
  hasDeepSeekKey: () => Promise<boolean>
  setDeepSeekKey: (key: string) => Promise<void>
  deleteDeepSeekKey: () => Promise<void>
}

// ---------------------------------------------------------------
// Chat API (streaming)
// ---------------------------------------------------------------

export interface ChatAPI {
  startStream: (
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    model?: string,
    thinking?: boolean
  ) => Promise<string>
  cancelStream: (sessionId: string) => Promise<void>
  onToken: (sessionId: string, callback: (token: string) => void) => () => void
  onThinking: (sessionId: string, callback: (text: string) => void) => () => void
  onError: (sessionId: string, callback: (error: StreamErrorData) => void) => () => void
  onEnd: (sessionId: string, callback: (finishReason: string) => void) => () => void
  onUsage: (sessionId: string, callback: (usage: StreamUsageData) => void) => () => void
  getPromptMessages: (input: {
    conversationId: string
    companionId: string
    textbookId?: string | null
    userMessage: string
    worldId?: string
    classMode?: 'standard' | 'feynman'
    hideNarration?: boolean
    pace?: 'slow' | 'normal' | 'fast'
  }) => Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>>
}

// ---------------------------------------------------------------
// Data API (conversations, textbooks, artifacts)
// ---------------------------------------------------------------

export interface DataAPI {
    writeTextFile: (filePath: string, content: string) => Promise<{ success: boolean }>
    exportBackup: (filePath: string) => Promise<{ fileCount: number }>
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
  truncateConversation: (conversationId: string, messageId: string, worldId?: string) => Promise<boolean>
  sendMessage: (input: {
    conversationId: string
    content: string
    role?: string
    worldId?: string
  }) => Promise<MessageDTO>
  updateMessage: (conversationId: string, messageId: string, content: string, worldId?: string) => Promise<MessageDTO | null>
  deleteMessage: (conversationId: string, messageId: string, worldId?: string) => Promise<boolean>
  listMessages: (conversationId: string, worldId?: string) => Promise<MessageDTO[]>
  searchMessages: (worldId: string, query: string, limit?: number, offset?: number) => Promise<{ results: SearchResultDTO[]; total: number }>
    endConversation: (conversationId: string, worldId?: string, classMode?: 'standard' | 'feynman') => Promise<{ success: boolean; artifacts: number; farewell?: string; failures: string[]; pending: boolean }>
    redoArtifacts: (conversationId: string, types: string[], worldId?: string) => Promise<{ success: boolean; artifacts: number; types: string[]; failures: string[] }>
    onArtifactsGenerated: (callback: (payload: ArtifactsGeneratedPayload) => void) => () => void
  createTextbook: (input: {
    worldId: string
    title: string
    format: 'markdown' | 'text' | 'pdf' | 'epub'
    sourceFile?: string
    content?: string
  }) => Promise<TextbookDTO>
  getTextbook: (textbookId: string, worldId?: string) => Promise<TextbookDTO | null>
  readTextbookOriginal: (textbookId: string, worldId?: string) => Promise<{ data: Uint8Array; fileName: string } | null>
  readEpubChapters: (textbookId: string, worldId?: string) => Promise<{
    chapters: Array<{ id: string; title: string; html: string }>
    title: string
    author: string
  }>
    searchTextbookExcerpt: (textbookId: string, chapter: string, worldId?: string) => Promise<{ chapter: string; excerpt: string } | null>
    translateTextbookExcerpt: (textbookId: string, chapter: string, worldId?: string) => Promise<{ chapter: string; excerpt: string; translation: string } | null>
  listTextbooks: (worldId: string) => Promise<TextbookDTO[]>
  updateTextbookContent: (textbookId: string, content: string, worldId?: string) => Promise<TextbookDTO | null>
  updateTextbook: (textbookId: string, updates: { title?: string; content?: string }, worldId?: string) => Promise<TextbookDTO | null>
  deleteTextbook: (textbookId: string, worldId?: string) => Promise<boolean>
  createArtifact: (input: {
    conversationId: string
    type: 'lesson_summary' | 'flashcards' | 'diary' | 'progress' | 'handoff_tail' | 'farewell' | 'learner_profile' | 'pal_moments' | 'relation' | 'companion_note'
    content: string
    worldId?: string
  }) => Promise<ArtifactDTO>
    getArtifact: (artifactId: string, conversationId: string, worldId?: string) => Promise<ArtifactDTO | null>
    updateArtifact: (artifactId: string, conversationId: string, content: string, worldId?: string) => Promise<ArtifactDTO | null>
    listArtifacts: (conversationId: string, worldId?: string) => Promise<ArtifactDTO[]>
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
  getFlashcardSrsState: () => Promise<Record<string, unknown>>
  saveFlashcardSrsState: (state: Record<string, unknown>) => Promise<{ success: boolean }>
  getFlashcardFavorites: () => Promise<string[]>
  saveFlashcardFavorites: (ids: string[]) => Promise<{ success: boolean }>
  deleteFlashcardCards: (cards: Array<{ conversationId: string; artifactId: string; cardIndex: number }>, worldId?: string) => Promise<{ success: boolean; deleted: number }>
  archive: {
    list: () => Promise<Array<{ id: string; kind: string; label: string; movedAt: string }>>
    restore: (entryId: string) => Promise<{ success: boolean }>
    purge: (entryId: string) => Promise<{ success: boolean }>
  }
  lock: {
    has: () => Promise<boolean>
    set: (pin: string) => Promise<{ success: boolean }>
    verify: (pin: string) => Promise<boolean>
    clear: () => Promise<{ success: boolean }>
  }
  exportPdf: (html: string, filePath: string) => Promise<{ success: boolean }>
  captureScreenshot: (filePath: string) => Promise<{ success: boolean }>
  composeAiAnswer: (question: string, history: string) => Promise<{ content: string }>
  reparseEpubContent: (textbookId: string, worldId?: string) => Promise<{ success: boolean; content: string }>
  diary: {
    listMonths: (worldId?: string) => Promise<string[]>
    getMonth: (month: string, worldId?: string) => Promise<string | null>
  }
}

// ---------------------------------------------------------------
// Companion API
// ---------------------------------------------------------------

export interface CompanionDTO {
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

export interface CompanionAPI {
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

// ---------------------------------------------------------------
// Dialog API
// ---------------------------------------------------------------

export interface DialogAPI {
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

// ---------------------------------------------------------------
// Provider API
// ---------------------------------------------------------------

export interface ProviderDTO {
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

export interface ProviderAPI {
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
  update: (id: string, updates: Record<string, unknown>) => Promise<ProviderDTO | null>
  delete: (id: string) => Promise<boolean>
  setActive: (id: string) => Promise<ProviderDTO | null>
  setApiKey: (id: string, apiKey: string) => Promise<void>
  hasApiKey: (id: string) => Promise<boolean>
  fetchModels: (baseUrl: string, apiKey: string) => Promise<string[]>
  testConnection: (baseUrl: string, apiKey: string) => Promise<{ success: boolean; models?: string[]; message?: string; error?: string }>
}

// ---------------------------------------------------------------
// SophiaAPI
// ---------------------------------------------------------------

export interface SyncWebDavConfig {
  url: string
  username: string
}

export interface SyncResult {
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

export interface SyncProgress {
  direction: 'push' | 'pull'
  current: number
  total: number
  file: string
}

export interface SyncPlanSummary {
  transferCount: number
  skipCount: number
  deleteCount: number
  deleteSample: string[]
}

export interface SyncAPI {
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
  /** Subscribe to per-file sync progress. Returns an unsubscribe function. */
  onProgress: (callback: (progress: SyncProgress) => void) => () => void
}

export interface AppAPI {
  minimizeToTray: () => Promise<void>
  openExternal: (url: string) => Promise<{ success: boolean }>
  /** Subscribe to "dictionary site refuses iframe embedding" events. */
  onDictFrameBlocked: (callback: (payload: { url: string }) => void) => () => void
}

export interface SophiaAPI {
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

// ---------------------------------------------------------------
// Event listener helpers (internal — not exposed)
// ---------------------------------------------------------------

function createEventSubscriber<P>(
  channel: string,
  sessionId: string,
  callback: (payload: P) => void
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: P & { sessionId: string }) => {
    if (payload.sessionId === sessionId) {
      const { sessionId: _sid, ...rest } = payload
      callback(rest as unknown as P)
    }
  }

  ipcRenderer.on(channel, handler)

  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

function createSimpleSubscriber<P>(
  channel: string,
  callback: (payload: P) => void
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: P) => {
    callback(payload)
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

// ---------------------------------------------------------------
// Build and expose the bridge
// ---------------------------------------------------------------

const sophia: SophiaAPI = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  app: {
    minimizeToTray: () => ipcRenderer.invoke('app:minimize-to-tray'),
    openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
    onDictFrameBlocked: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { url: string }) => {
        callback(payload)
      }
      ipcRenderer.on('dict:frame-blocked', handler)
      return () => {
        ipcRenderer.removeListener('dict:frame-blocked', handler)
      }
    }
  },
  settings: {
    hasDeepSeekKey: () => ipcRenderer.invoke('settings:has-deepseek-key'),
    setDeepSeekKey: (key: string) => ipcRenderer.invoke('settings:set-deepseek-key', { key }),
    deleteDeepSeekKey: () => ipcRenderer.invoke('settings:delete-deepseek-key')
  },
  chat: {
    startStream: (messages, model, thinking) =>
      ipcRenderer.invoke(CHAT_STREAM_START, { messages, model, thinking }),

    cancelStream: (sessionId: string) =>
      ipcRenderer.invoke(CHAT_STREAM_CANCEL, { sessionId }),

    onToken: (sessionId: string, callback: (token: string) => void) =>
      createEventSubscriber<{ token: string }>(
        CHAT_STREAM_EVENT.token,
        sessionId,
        (payload) => callback(payload.token)
      ),

    onThinking: (sessionId: string, callback: (text: string) => void) =>
      createEventSubscriber<{ text: string }>(
        CHAT_STREAM_EVENT.thinking,
        sessionId,
        (payload) => callback(payload.text)
      ),

    onError: (sessionId: string, callback: (error: StreamErrorData) => void) =>
      createEventSubscriber<StreamErrorData>(
        CHAT_STREAM_EVENT.error,
        sessionId,
        callback
      ),

    onEnd: (sessionId: string, callback: (finishReason: string) => void) =>
      createEventSubscriber<{ finishReason: string }>(
        CHAT_STREAM_EVENT.end,
        sessionId,
        (payload) => callback(payload.finishReason)
      ),

    onUsage: (sessionId: string, callback: (usage: StreamUsageData) => void) =>
      createEventSubscriber<StreamUsageData>(
        CHAT_STREAM_EVENT.usage,
        sessionId,
        callback
      ),

    getPromptMessages: (input) =>
      ipcRenderer.invoke('chat:get-prompt-messages', input)
  },
  data: {
    writeTextFile: (filePath, content) => ipcRenderer.invoke('file:writeText', { filePath, content }),
    exportBackup: (filePath) => ipcRenderer.invoke('data:export-backup', { filePath }),
    createConversation: (input) =>
      ipcRenderer.invoke('conversation:create', input),
    getConversation: (conversationId, worldId = 'world_default') =>
      ipcRenderer.invoke('conversation:get', { conversationId, worldId }),
    listConversations: (worldId) =>
      ipcRenderer.invoke('conversation:list', { worldId }),
    deleteConversation: (conversationId, worldId = 'world_default') =>
      ipcRenderer.invoke('conversation:delete', { conversationId, worldId }),
    updateTitle: (conversationId, title, worldId = 'world_default') =>
      ipcRenderer.invoke('conversation:update-title', { conversationId, title, worldId }),
    truncateConversation: (conversationId, messageId, worldId = 'world_default') =>
      ipcRenderer.invoke('conversation:truncate', { conversationId, messageId, worldId }),
    sendMessage: (input) =>
      ipcRenderer.invoke('message:send', input),
    updateMessage: (conversationId, messageId, content, worldId = 'world_default') =>
      ipcRenderer.invoke('message:update', { conversationId, messageId, content, worldId }),
    deleteMessage: (conversationId, messageId, worldId = 'world_default') =>
      ipcRenderer.invoke('message:delete', { conversationId, messageId, worldId }),
    listMessages: (conversationId, worldId = 'world_default') =>
      ipcRenderer.invoke('message:list', { conversationId, worldId }),
    searchMessages: (worldId, query, limit, offset) =>
      ipcRenderer.invoke('message:search', { worldId, query, limit, offset }),
    endConversation: (conversationId, worldId = 'world_default', classMode) =>
      ipcRenderer.invoke('conversation:end', { conversationId, worldId, classMode }),
    redoArtifacts: (conversationId, types, worldId = 'world_default') =>
      ipcRenderer.invoke('conversation:redo-artifacts', { conversationId, types, worldId }),
    onArtifactsGenerated: (callback) =>
      createSimpleSubscriber<ArtifactsGeneratedPayload>(ARTIFACTS_GENERATED, callback),
    createTextbook: (input) =>
      ipcRenderer.invoke('textbook:create', input),
    getTextbook: (textbookId, worldId = 'world_default') =>
      ipcRenderer.invoke('textbook:get', { textbookId, worldId }),
    readTextbookOriginal: (textbookId, worldId = 'world_default') =>
      ipcRenderer.invoke('textbook:read-original', { textbookId, worldId }),
    readEpubChapters: (textbookId, worldId = 'world_default') =>
      ipcRenderer.invoke('epub:read-chapters', { textbookId, worldId }),
    searchTextbookExcerpt: (textbookId, chapter, worldId = 'world_default') =>
      ipcRenderer.invoke('textbook:search-excerpt', { textbookId, chapter, worldId }),
    translateTextbookExcerpt: (textbookId, chapter, worldId = 'world_default') =>
      ipcRenderer.invoke('textbook:translate-excerpt', { textbookId, chapter, worldId }),
    listTextbooks: (worldId) =>
      ipcRenderer.invoke('textbook:list', { worldId }),
    updateTextbookContent: (textbookId, content, worldId = 'world_default') =>
      ipcRenderer.invoke('textbook:update-content', { textbookId, content, worldId }),
    updateTextbook: (textbookId, updates, worldId = 'world_default') =>
      ipcRenderer.invoke('textbook:update', { textbookId, ...updates, worldId }),
    deleteTextbook: (textbookId, worldId = 'world_default') =>
      ipcRenderer.invoke('textbook:delete', { textbookId, worldId }),
    createArtifact: (input) =>
      ipcRenderer.invoke('artifact:create', input),
    getArtifact: (artifactId, conversationId, worldId = 'world_default') =>
      ipcRenderer.invoke('artifact:get', { artifactId, conversationId, worldId }),
    updateArtifact: (artifactId, conversationId, content, worldId = 'world_default') =>
      ipcRenderer.invoke('artifact:update', { artifactId, conversationId, content, worldId }),
    listArtifacts: (conversationId, worldId = 'world_default') =>
      ipcRenderer.invoke('artifact:list', { conversationId, worldId }),
    updateTextbookProgress: (textbookId, progress, worldId = 'world_default') =>
      ipcRenderer.invoke('textbook:update-progress', { textbookId, ...progress, worldId }),
    createReadingNote: (input) =>
      ipcRenderer.invoke('reading-note:create', input),
    listReadingNotes: (textbookId, worldId = 'world_default') =>
      ipcRenderer.invoke('reading-note:list', { textbookId, worldId }),
    updateReadingNote: (noteId, textbookId, updates, worldId = 'world_default') =>
      ipcRenderer.invoke('reading-note:update', { noteId, textbookId, ...updates, worldId }),
    deleteReadingNote: (noteId, textbookId, worldId = 'world_default') =>
      ipcRenderer.invoke('reading-note:delete', { noteId, textbookId, worldId }),
    getFlashcardSrsState: () => ipcRenderer.invoke('flashcard:get-srs-state'),
    saveFlashcardSrsState: (state) => ipcRenderer.invoke('flashcard:save-srs-state', state),
    getFlashcardFavorites: () => ipcRenderer.invoke('flashcard:get-favorites'),
    saveFlashcardFavorites: (ids) => ipcRenderer.invoke('flashcard:save-favorites', ids),
    deleteFlashcardCards: (cards, worldId = 'world_default') =>
      ipcRenderer.invoke('flashcard:delete-cards', { cards, worldId }),
    archive: {
      list: () => ipcRenderer.invoke('archive:list'),
      restore: (entryId) => ipcRenderer.invoke('archive:restore', { entryId }),
      purge: (entryId) => ipcRenderer.invoke('archive:purge', { entryId })
    },
    lock: {
      has: () => ipcRenderer.invoke('lock:has'),
      set: (pin) => ipcRenderer.invoke('lock:set', { pin }),
      verify: (pin) => ipcRenderer.invoke('lock:verify', { pin }),
      clear: () => ipcRenderer.invoke('lock:clear')
    },
    exportPdf: (html, filePath) => ipcRenderer.invoke('pdf:export', { html, filePath }),
    captureScreenshot: (filePath) => ipcRenderer.invoke('screenshot:capture', { filePath }),
    composeAiAnswer: (question, history) => ipcRenderer.invoke('ai:compose-answer', { question, history }),
    reparseEpubContent: (textbookId, worldId = 'world_default') =>
      ipcRenderer.invoke('epub:reparse-content', { textbookId, worldId }),
    diary: {
      listMonths: (worldId = 'world_default') => ipcRenderer.invoke('diary:list-months', { worldId }),
      getMonth: (month, worldId = 'world_default') => ipcRenderer.invoke('diary:get-month', { worldId, month })
    }
  },
  companions: {
    list: () => ipcRenderer.invoke('companion:list'),
    get: (companionId: string) => ipcRenderer.invoke('companion:get', { companionId }),
    create: (input) => ipcRenderer.invoke('companion:create', input),
    update: (companionId, updates) => ipcRenderer.invoke('companion:update', { companionId, ...updates }),
    delete: (companionId: string) => ipcRenderer.invoke('companion:delete', { companionId })
  },
  dialog: {
    openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
    saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
    confirm: (options) => ipcRenderer.invoke('dialog:confirm', options)
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    get: (id) => ipcRenderer.invoke('providers:get', { id }),
    getActive: () => ipcRenderer.invoke('providers:get-active'),
    create: (input) => ipcRenderer.invoke('providers:create', input),
    update: (id, updates) => ipcRenderer.invoke('providers:update', { id, ...updates }),
    delete: (id) => ipcRenderer.invoke('providers:delete', { id }),
    setActive: (id) => ipcRenderer.invoke('providers:set-active', { id }),
    setApiKey: (id, apiKey) => ipcRenderer.invoke('providers:set-api-key', { id, apiKey }),
    hasApiKey: (id) => ipcRenderer.invoke('providers:has-api-key', { id }),
    fetchModels: (baseUrl, apiKey) => ipcRenderer.invoke('providers:fetch-models', { baseUrl, apiKey }),
    testConnection: (baseUrl, apiKey) => ipcRenderer.invoke('providers:test-connection', { baseUrl, apiKey })
  },
  sync: {
    test: (config) => ipcRenderer.invoke('sync:test', config),
    planPush: (config) => ipcRenderer.invoke('sync:plan-push', config),
    planPull: (config) => ipcRenderer.invoke('sync:plan-pull', config),
    push: (config) => ipcRenderer.invoke('sync:push', config),
    pull: (config) => ipcRenderer.invoke('sync:pull', config),
    listTrash: (config) => ipcRenderer.invoke('sync:list-trash', config),
    emptyTrash: (config) => ipcRenderer.invoke('sync:empty-trash', config),
    hasWebdavPassword: () => ipcRenderer.invoke('sync:has-webdav-password'),
    setWebdavPassword: (password) => ipcRenderer.invoke('sync:set-webdav-password', { password }),
    onProgress: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: SyncProgress) => {
        callback(progress)
      }
      ipcRenderer.on('sync:progress', handler)
      return () => {
        ipcRenderer.removeListener('sync:progress', handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('sophia', sophia)
