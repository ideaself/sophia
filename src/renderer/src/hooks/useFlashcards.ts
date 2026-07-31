import { useCallback, useEffect, useState } from 'react'
import { parseFlashcards } from '../../../shared/flashcard-utils'
import { WORLD_ID } from '../types/models'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Flashcard {
  id: string
  artifactId: string
  cardIndex: number
  conversationId: string
  conversationTitle: string
  createdAt: string
  question: string
  answer: string
}

export interface SrsState {
  interval: number
  ease: number
  reps: number
  nextReview: number
  lastReview: number
}

export type Rating = 'again' | 'hard' | 'good' | 'easy'

interface RawArtifact {
  id: string
  conversationId: string
  type: string
  content: string
  createdAt: string
}

interface ConversationDTO {
  id: string
  title: string
  companionId: string
  endedAt: string | null
}

// ---------------------------------------------------------------------------
// SM-2 spaced repetition
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

export function newSrsState(): SrsState {
  return { interval: 0, ease: 2.5, reps: 0, nextReview: 0, lastReview: 0 }
}

function qualityOf(rating: Rating): number {
  return { again: 0, hard: 3, good: 4, easy: 5 }[rating]
}

export function updateSrs(state: SrsState, rating: Rating): SrsState {
  const q = qualityOf(rating)
  const now = Date.now()

  if (q < 3) {
    return {
      interval: 1,
      ease: Math.max(1.3, state.ease - 0.2),
      reps: 0,
      nextReview: now + DAY_MS,
      lastReview: now
    }
  }

  const reps = state.reps + 1
  let interval: number
  if (reps === 1) {
    interval = rating === 'easy' ? 4 : 1
  } else if (reps === 2) {
    interval = rating === 'easy' ? 8 : 3
  } else {
    interval = Math.round(state.interval * state.ease)
  }

  const ease = Math.max(1.3, state.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))

  return {
    interval,
    ease,
    reps,
    nextReview: now + interval * DAY_MS,
    lastReview: now
  }
}

export function isDue(state: SrsState | undefined, now: number): boolean {
  if (!state || state.nextReview === 0) return true // new card
  return state.nextReview <= now
}

// ---------------------------------------------------------------------------
// SRS persistence (localStorage + flashcard-srs.json for WebDAV sync)
// ---------------------------------------------------------------------------

const SRS_KEY = 'flashcard-srs-state'

export function loadAllSrsLocal(): Record<string, SrsState> {
  try {
    const raw = localStorage.getItem(SRS_KEY)
    return raw ? JSON.parse(raw) as Record<string, SrsState> : {}
  } catch {
    return {}
  }
}

export function saveAllSrsLocal(states: Record<string, SrsState>): void {
  try {
    localStorage.setItem(SRS_KEY, JSON.stringify(states))
  } catch {
    // quota / disabled storage - best-effort
  }
}

export async function loadAllSrs(): Promise<Record<string, SrsState>> {
  try {
    const remote = await window.sophia.data.getFlashcardSrsState()
    const states = remote as Record<string, SrsState>
    saveAllSrsLocal(states)
    return states
  } catch {
    return loadAllSrsLocal()
  }
}

export function saveAllSrs(states: Record<string, SrsState>): void {
  saveAllSrsLocal(states)
  void window.sophia.data.saveFlashcardSrsState(states as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// Loading all flashcards from ended conversations
// ---------------------------------------------------------------------------

export async function loadAllFlashcards(): Promise<Flashcard[]> {
  const conversations = await window.sophia.data.listConversations(WORLD_ID) as ConversationDTO[]
  const endedConvs = conversations.filter((c) => c.endedAt)
  const allCards: Flashcard[] = []

  for (const conv of endedConvs) {
    try {
      const artifacts = await window.sophia.data.listArtifacts(conv.id) as RawArtifact[]
      const flashcardArtifacts = artifacts.filter((a) => a.type === 'flashcards')
      for (const art of flashcardArtifacts) {
        const parsed = parseFlashcards(art.content)
        for (let i = 0; i < parsed.length; i++) {
          allCards.push({
            id: `${art.id}_${i}`,
            artifactId: art.id,
            cardIndex: i,
            conversationId: conv.id,
            conversationTitle: conv.title,
            createdAt: art.createdAt,
            question: parsed[i].question,
            answer: parsed[i].answer
          })
        }
      }
    } catch {
      // skip
    }
  }
  return allCards
}

/**
 * Number of flashcards due for review right now. Refreshes on mount, on
 * window focus, and every minute so the nav badge stays truthful.
 */
export function useDueFlashcardCount(): number {
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const [cards, states] = await Promise.all([loadAllFlashcards(), loadAllSrs()])
      const now = Date.now()
      setCount(cards.filter((c) => isDue(states[c.id], now)).length)
    } catch {
      // keep the previous value on failure
    }
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    const timer = setInterval(refresh, 60_000)
    return () => {
      window.removeEventListener('focus', refresh)
      clearInterval(timer)
    }
  }, [refresh])

  return count
}
