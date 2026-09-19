import { describe, it, expect } from 'vitest'
import {
  SRS_DAY_MS,
  isConceptDue,
  newConceptSrs,
  nextReviewLabel,
  updateConceptSrs
} from '../../src/shared/concept-srs'

const NOW = Date.parse('2026-09-20T08:00:00.000Z')

describe('concept SRS (SM-2)', () => {
  it('schedules the first review one day after creation', () => {
    const srs = newConceptSrs(NOW)
    expect(srs).toEqual({
      interval: 0,
      ease: 2.5,
      reps: 0,
      nextReview: NOW + SRS_DAY_MS,
      lastReview: 0
    })
    expect(isConceptDue(srs, NOW)).toBe(false)
  })

  it('advances intervals for hard/good/easy and resets on again', () => {
    const initial = newConceptSrs(NOW)

    const firstGood = updateConceptSrs(initial, 'good', NOW)
    expect(firstGood.reps).toBe(1)
    expect(firstGood.interval).toBe(1)
    expect(firstGood.nextReview).toBe(NOW + SRS_DAY_MS)

    const firstEasy = updateConceptSrs(initial, 'easy', NOW)
    expect(firstEasy.interval).toBe(4)

    const secondGood = updateConceptSrs(firstGood, 'good', NOW)
    expect(secondGood.reps).toBe(2)
    expect(secondGood.interval).toBe(3)

    const secondEasy = updateConceptSrs(firstEasy, 'easy', NOW)
    expect(secondEasy.interval).toBe(8)

    // Third+ review multiplies the previous interval by the previous ease.
    const third = updateConceptSrs(secondGood, 'good', NOW)
    expect(third.reps).toBe(3)
    expect(third.interval).toBe(Math.round(secondGood.interval * secondGood.ease))

    const again = updateConceptSrs({ ...secondGood, ease: 1.35 }, 'again', NOW)
    expect(again.interval).toBe(1)
    expect(again.reps).toBe(0)
    expect(again.ease).toBe(1.3)
    expect(again.lastReview).toBe(NOW)
    expect(again.nextReview).toBe(NOW + SRS_DAY_MS)

    // Ease never drops below the floor on the hard branch either.
    const floored = updateConceptSrs({ ...initial, ease: 1.3 }, 'hard', NOW)
    expect(floored.ease).toBe(1.3)
  })

  it('reports due state and human-readable next-review labels', () => {
    expect(isConceptDue(undefined, NOW)).toBe(true)
    expect(isConceptDue({ ...newConceptSrs(NOW), nextReview: NOW - 1 }, NOW)).toBe(true)
    expect(isConceptDue({ ...newConceptSrs(NOW), nextReview: NOW }, NOW)).toBe(true)

    expect(nextReviewLabel({ ...newConceptSrs(NOW), nextReview: NOW - 1 }, NOW)).toBe('今天')
    expect(nextReviewLabel({ ...newConceptSrs(NOW), nextReview: NOW + SRS_DAY_MS }, NOW)).toBe('明天')
    expect(nextReviewLabel({ ...newConceptSrs(NOW), nextReview: NOW + 3 * SRS_DAY_MS }, NOW)).toBe('3 天后')
  })
})
