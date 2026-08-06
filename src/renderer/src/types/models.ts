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
  { id: 'auto', name: '跟随系统', preview: { bg: '#191a1d', surface: '#fafaf9', accent: '#6b7280', text: '#d4d4d4' } },
  { id: 'dark', name: '暗夜', preview: { bg: '#191a1d', surface: '#212226', accent: '#6b7280', text: '#f0f1f3' } },
  { id: 'emerald', name: '护眼', preview: { bg: '#d6eace', surface: '#e2f1e3', accent: '#3d7a4e', text: '#2d2d2d' } },
  { id: 'light', name: '暖光', preview: { bg: '#fafaf9', surface: '#ffffff', accent: '#b45309', text: '#1c1917' } }
]

export const WORLD_ID = 'world_default'
