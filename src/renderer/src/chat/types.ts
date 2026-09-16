/**
 * Shared classroom types (used by ClassroomView and its hooks).
 */

export interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 消息时间（仅持久化消息有；本地乐观消息为空则不显示）。 */
  createdAt?: string
}

export interface TabState {
  id: string
  title: string
  conversationId: string | null
  classMode: 'standard' | 'feynman'
  pace: 'slow' | 'normal' | 'fast'
  messages: DisplayMessage[]
  input: string
  retryMessage: { input: string; convId: string } | null
  endResult: {
    artifacts: number
    farewell?: string
    failures?: string[]
    conversationId?: string
    pending?: boolean
    generationError?: string
  } | null
}

/** Composer input limit (also enforced by the send hook). */
export const MAX_INPUT_LENGTH = 20000
