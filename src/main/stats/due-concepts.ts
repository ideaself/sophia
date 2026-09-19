/**
 * Due-concept counting for the nav badge / daily reminder.
 * Lives in the main process so the renderer only receives a single number.
 */

import type { ConceptSrsState } from '../../shared/concept-srs'

export interface ConceptLike {
  srs?: ConceptSrsState
}

/**
 * Count concepts due for spaced review.
 * A concept without a schedule counts as due (legacy / never reviewed);
 * otherwise it is due once `nextReview` has passed.
 */
export function countDueConcepts(concepts: ConceptLike[], now: number): { due: number; total: number } {
  let due = 0
  for (const concept of concepts) {
    if (!concept.srs || concept.srs.nextReview <= now) due++
  }
  return { due, total: concepts.length }
}
