import { describe, it, expect } from 'vitest'
import { countDueConcepts } from '../../../src/main/stats/due-concepts'
import type { ConceptSrsState } from '../../../src/shared/concept-srs'

const NOW = Date.parse('2026-09-20T08:00:00.000Z')

function srs(nextReview: number): ConceptSrsState {
  return { interval: 1, ease: 2.5, reps: 1, nextReview, lastReview: 0 }
}

describe('countDueConcepts', () => {
  it('counts missing schedules and past-due concepts', () => {
    const result = countDueConcepts(
      [
        { srs: srs(NOW - 1) },
        { srs: srs(NOW) },
        { srs: srs(NOW + 1) },
        {}
      ],
      NOW
    )
    expect(result).toEqual({ due: 3, total: 4 })
  })

  it('handles an empty list', () => {
    expect(countDueConcepts([], NOW)).toEqual({ due: 0, total: 0 })
  })
})
