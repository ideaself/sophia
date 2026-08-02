export type AppView = 'settings' | 'companions' | 'textbooks' | 'classroom' | 'history' | 'flashcards' | 'stats' | 'review'

export interface Companion {
  id: string
  name: string
  identity: string
  personalityKeywords: string[]
}

export interface Textbook {
  id: string
  title: string
  format: string
  originalFile: string
  /** 提取的教材正文（列表接口会返回，用于检测正文缺失）。 */
  content?: string
}

export interface ActiveConversation {
  id: string
  companionId: string
  companionName: string
  textbookId: string | null
  textbookTitle: string | null
  title: string
  updatedAt: string
}

export interface ThemeOption {
  id: string
  name: string
  preview: { bg: string; surface: string; accent: string; text: string }
}

export const THEMES: ThemeOption[] = [
  { id: 'dark', name: '暗夜', preview: { bg: '#111827', surface: '#1f2937', accent: '#2563eb', text: '#f3f4f6' } },
  { id: 'midnight', name: '午夜蓝', preview: { bg: '#0a0e1a', surface: '#111832', accent: '#3b82f6', text: '#f0f4ff' } },
  { id: 'emerald', name: '森林', preview: { bg: '#11130f', surface: '#1a1e16', accent: '#84cc16', text: '#e8ebe4' } },
  { id: 'light', name: '暖光', preview: { bg: '#fafaf9', surface: '#ffffff', accent: '#b45309', text: '#1c1917' } }
]

export const WORLD_ID = 'world_default'
