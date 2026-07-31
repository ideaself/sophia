import { describe, it, expect } from 'vitest'
import {
  estimateDailyStudyMinutes,
  computeStreak,
  buildHeatmapWeeks,
  dayKey,
  addSessionMinutes
} from '../../src/shared/study-time'

const H = 60 * 60 * 1000
const M = 60 * 1000

function at(y: number, mo: number, d: number, h: number, min: number): number {
  return new Date(y, mo - 1, d, h, min).getTime()
}

describe('estimateDailyStudyMinutes', () => {
  it('measures the span of consecutive messages within a session', () => {
    const perDay = estimateDailyStudyMinutes([
      at(2026, 7, 6, 10, 0),
      at(2026, 7, 6, 10, 30),
      at(2026, 7, 6, 11, 0)
    ])
    expect(perDay.get('2026-07-06')).toBe(60 * M)
  })

  it('splits a session across midnight into the days it actually spans', () => {
    const perDay = estimateDailyStudyMinutes([
      at(2026, 7, 6, 23, 30),
      at(2026, 7, 6, 23, 50),
      at(2026, 7, 7, 0, 10),
      at(2026, 7, 7, 0, 30)
    ])
    expect(perDay.get('2026-07-06')).toBe(30 * M)
    expect(perDay.get('2026-07-07')).toBe(30 * M)
  })

  it('starts a new session when the gap exceeds 45 minutes', () => {
    const perDay = estimateDailyStudyMinutes([
      at(2026, 7, 6, 10, 0),
      at(2026, 7, 6, 10, 20),
      at(2026, 7, 6, 12, 0),
      at(2026, 7, 6, 12, 10)
    ])
    // Session 1: 20 min; session 2: 10 min.
    expect(perDay.get('2026-07-06')).toBe(30 * M)
  })

  it('caps a single session at 4 hours', () => {
    // Messages every 30 minutes from 09:00 to 18:00 — one continuous
    // session of 9 hours, which must be capped at 4.
    const stamps: number[] = []
    for (let h = 9; h <= 18; h++) {
      stamps.push(at(2026, 7, 6, h, 0))
      if (h < 18) stamps.push(at(2026, 7, 6, h, 30))
    }
    const perDay = estimateDailyStudyMinutes(stamps)
    expect(perDay.get('2026-07-06')).toBe(4 * H)
  })

  it('ignores non-finite timestamps', () => {
    const perDay = estimateDailyStudyMinutes([
      Number.NaN,
      at(2026, 7, 6, 10, 0),
      at(2026, 7, 6, 10, 15)
    ])
    expect(perDay.get('2026-07-06')).toBe(15 * M)
  })
})

describe('addSessionMinutes', () => {
  it('allocates only within the given bounds', () => {
    const perDay = new Map<string, number>()
    addSessionMinutes(perDay, at(2026, 7, 6, 23, 0), at(2026, 7, 7, 1, 0))
    expect(perDay.get('2026-07-06')).toBe(60 * M)
    expect(perDay.get('2026-07-07')).toBe(60 * M)
  })
})

describe('computeStreak', () => {
  it('counts consecutive days ending today', () => {
    const perDay = new Map<string, number>()
    const today = new Date()
    for (let i = 0; i < 4; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      perDay.set(dayKey(d), 10 * M)
    }
    expect(computeStreak(perDay)).toBe(4)
  })

  it('still counts a streak that ends yesterday', () => {
    const perDay = new Map<string, number>()
    const today = new Date()
    for (let i = 1; i <= 3; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      perDay.set(dayKey(d), 10 * M)
    }
    expect(computeStreak(perDay)).toBe(3)
  })

  it('returns 0 when there is no recent activity', () => {
    const perDay = new Map<string, number>()
    const d = new Date()
    d.setDate(d.getDate() - 10)
    perDay.set(dayKey(d), 10 * M)
    expect(computeStreak(perDay)).toBe(0)
  })
})

describe('buildHeatmapWeeks', () => {
  it('produces weeks of 7 days starting on a Sunday', () => {
    const perDay = new Map<string, number>()
    const weeks = buildHeatmapWeeks(perDay)
    expect(weeks.length).toBeGreaterThanOrEqual(52)
    for (const week of weeks) {
      expect(week).toHaveLength(7)
    }
    const [y, m, d] = weeks[0][0].key.split('-').map(Number)
    expect(new Date(y, m - 1, d).getDay()).toBe(0)
  })
})
