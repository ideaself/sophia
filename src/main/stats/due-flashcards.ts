/**
 * Due-flashcard counting for the nav badge.
 *
 * Lives in the main process: the renderer used to pull every artifact of
 * every ended conversation over IPC just to count cards (and re-did it on
 * every focus and every 60 s). The renderer now gets a single number.
 */

import { parseFlashcards } from '../../shared/flashcard-utils'

export interface FlashcardArtifactLike {
  id: string
  type: string
  content: string
}

export interface SrsStateLike {
  nextReview?: number
}

/**
 * Count flashcards that are due for review.
 *
 * Due semantics mirror the renderer's `isDue`: a card with no SRS record
 * or `nextReview === 0` is new (due); otherwise it is due when its
 * nextReview timestamp has passed.
 */
export function countDueFlashcards(
  artifacts: FlashcardArtifactLike[],
  srsStates: Record<string, SrsStateLike>,
  now: number
): { due: number; total: number } {
  let due = 0
  let total = 0

  for (const artifact of artifacts) {
    if (artifact.type !== 'flashcards') continue
    const cards = parseFlashcards(artifact.content)
    for (let i = 0; i < cards.length; i++) {
      total++
      const state = srsStates[`${artifact.id}_${i}`]
      const next = state?.nextReview
      if (!state || next === 0) {
        due++
      } else if (typeof next === 'number' && next <= now) {
        due++
      }
    }
  }

  return { due, total }
}
