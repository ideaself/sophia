import { contextBridge, ipcRenderer } from 'electron'
import {
  CHAT_STREAM_START,
  CHAT_STREAM_CANCEL,
  CHAT_STREAM_EVENT
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
  format: 'markdown' | 'text' | 'pdf' | 'epub'
  sourceFile: string
  originalFile: string
  content: string
  progress: { currentPage: number; totalPages: number | null }
  createdAt: string
  updatedAt: string
}

export interface ArtifactDTO {
  id: string
  conversationId: string
  type: 'lesson_summary' | 'flashcards' | 'diary' | 'progress' | 'handoff_tail'
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
    model?: string
  ) => Promise<string>
  cancelStream: (sessionId: string) => Promise<void>
  onToken: (sessionId: string, callback: (token: string) => void) => () => void
  onError: (sessionId: string, callback: (error: StreamErrorData) => void) => () => void
  onEnd: (sessionId: string, callback: (finishReason: string) => void) => () => void
  onUsage: (sessionId: string, callback: (usage: StreamUsageData) => void) => () => void
  getPromptMessages: (input: {
    conversationId: string
    companionId: string
    textbookId?: string | null
    userMessage: string
    worldId?: string
  }) => Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>>
}

// ---------------------------------------------------------------
// Data API (conversations, textbooks, artifacts)
// ---------------------------------------------------------------

export interface DataAPI {
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
  readTextbookOriginal: (textbookId: string, worldId?: string) => Promise<{ data: Uint8Array; fileName: string } | null>
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
  count: number
  errors: string[]
  timestamp?: string
}

export interface SyncProgress {
  direction: 'push' | 'pull'
  current: number
  total: number
  file: string
}

export interface SyncAPI {
  test: (config: SyncWebDavConfig) => Promise<{ success: boolean; message?: string }>
  push: (config: SyncWebDavConfig) => Promise<SyncResult>
  pull: (config: SyncWebDavConfig) => Promise<SyncResult>
  hasWebdavPassword: () => Promise<boolean>
  setWebdavPassword: (password: string) => Promise<void>
  /** Subscribe to per-file sync progress. Returns an unsubscribe function. */
  onProgress: (callback: (progress: SyncProgress) => void) => () => void
}

export interface SophiaAPI {
  getVersion: () => Promise<string>
  getPlatform: () => Promise<string>
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

// ---------------------------------------------------------------
// Build and expose the bridge
// ---------------------------------------------------------------

const sophia: SophiaAPI = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  settings: {
    hasDeepSeekKey: () => ipcRenderer.invoke('settings:has-deepseek-key'),
    setDeepSeekKey: (key: string) => ipcRenderer.invoke('settings:set-deepseek-key', { key }),
    deleteDeepSeekKey: () => ipcRenderer.invoke('settings:delete-deepseek-key')
  },
  chat: {
    startStream: (messages, model) =>
      ipcRenderer.invoke(CHAT_STREAM_START, { messages, model }),

    cancelStream: (sessionId: string) =>
      ipcRenderer.invoke(CHAT_STREAM_CANCEL, { sessionId }),

    onToken: (sessionId: string, callback: (token: string) => void) =>
      createEventSubscriber<{ token: string }>(
        CHAT_STREAM_EVENT.token,
        sessionId,
        (payload) => callback(payload.token)
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
    sendMessage: (input) =>
      ipcRenderer.invoke('message:send', input),
    listMessages: (conversationId, worldId = 'world_default') =>
      ipcRenderer.invoke('message:list', { conversationId, worldId }),
    searchMessages: (worldId, query) =>
      ipcRenderer.invoke('message:search', { worldId, query }),
    endConversation: (conversationId, worldId = 'world_default') =>
      ipcRenderer.invoke('conversation:end', { conversationId, worldId }),
    createTextbook: (input) =>
      ipcRenderer.invoke('textbook:create', input),
    getTextbook: (textbookId, worldId = 'world_default') =>
      ipcRenderer.invoke('textbook:get', { textbookId, worldId }),
    readTextbookOriginal: (textbookId, worldId = 'world_default') =>
      ipcRenderer.invoke('textbook:read-original', { textbookId, worldId }),
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
    listArtifacts: (conversationId, worldId = 'world_default') =>
      ipcRenderer.invoke('artifact:list', { conversationId, worldId }),
    generateArtifacts: (conversationId, apiKey, worldId = 'world_default') =>
      ipcRenderer.invoke('artifact:generate', { conversationId, apiKey, worldId })
  },
  companions: {
    list: () => ipcRenderer.invoke('companion:list'),
    get: (companionId: string) => ipcRenderer.invoke('companion:get', { companionId }),
    create: (input) => ipcRenderer.invoke('companion:create', input),
    update: (companionId, updates) => ipcRenderer.invoke('companion:update', { companionId, ...updates }),
    delete: (companionId: string) => ipcRenderer.invoke('companion:delete', { companionId })
  },
  dialog: {
    openFile: (options) => ipcRenderer.invoke('dialog:openFile', options)
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
    push: (config) => ipcRenderer.invoke('sync:push', config),
    pull: (config) => ipcRenderer.invoke('sync:pull', config),
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
