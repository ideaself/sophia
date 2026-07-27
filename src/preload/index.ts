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
  sendMessage: (input: {
    conversationId: string
    content: string
    role?: string
    worldId?: string
  }) => Promise<MessageDTO>
  listMessages: (conversationId: string, worldId?: string) => Promise<MessageDTO[]>
  searchMessages: (worldId: string, query: string) => Promise<SearchResultDTO[]>
  endConversation: (conversationId: string, worldId?: string) => Promise<boolean>
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
// SophiaAPI
// ---------------------------------------------------------------

export interface SophiaAPI {
  getVersion: () => Promise<string>
  getPlatform: () => Promise<string>
  settings: SettingsAPI
  chat: ChatAPI
  data: DataAPI
  companions: CompanionAPI
  dialog: DialogAPI
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
    listTextbooks: (worldId) =>
      ipcRenderer.invoke('textbook:list', { worldId }),
    updateTextbookContent: (textbookId, content, worldId = 'world_default') =>
      ipcRenderer.invoke('textbook:update-content', { textbookId, content, worldId }),
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
    get: (companionId: string) => ipcRenderer.invoke('companion:get', { companionId })
  },
  dialog: {
    openFile: (options) => ipcRenderer.invoke('dialog:openFile', options)
  }
}

contextBridge.exposeInMainWorld('sophia', sophia)
