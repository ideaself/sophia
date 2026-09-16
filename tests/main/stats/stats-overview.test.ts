import { describe, it, expect } from 'vitest'

import {
  buildStatsOverview,
  weekStartOf,
  type StatsOverviewInput
} from '../../../src/main/stats/overview'
import { dayKey } from '../../../src/shared/study-time'

function atLocal(day: Date, hours: number, minutes: number): string {
  const d = new Date(day)
  d.setHours(hours, minutes, 0, 0)
  return d.toISOString()
}

const NOW = new Date('2026-07-06T15:00:00')
const TODAY = new Date(NOW)
const TEN_DAYS_AGO = new Date(NOW)
TEN_DAYS_AGO.setDate(TEN_DAYS_AGO.getDate() - 10)

function baseInput(overrides: Partial<StatsOverviewInput> = {}): StatsOverviewInput {
  return {
    conversations: [
      { id: 'c1', companionId: 'comp_a', textbookId: 'tb_1' },
      { id: 'c2', companionId: 'comp_b', textbookId: null }
    ],
    messagesByConversation: {
      c1: [
        { createdAt: atLocal(TODAY, 9, 0) },
        { createdAt: atLocal(TODAY, 9, 30) },
        { createdAt: atLocal(TODAY, 14, 0) }
      ],
      c2: [{ createdAt: atLocal(TEN_DAYS_AGO, 10, 0) }]
    },
    artifactsByConversation: {
      c1: [{ createdAt: atLocal(TODAY, 9, 45) }],
      c2: [{ createdAt: atLocal(TEN_DAYS_AGO, 10, 30) }]
    },
    now: NOW,
    ...overrides
  }
}

describe('buildStatsOverview', () => {
  it('counts messages and artifacts per conversation and in total', () => {
    const result = buildStatsOverview(baseInput())
    expect(result.messageCounts).toEqual({ c1: 3, c2: 1 })
    expect(result.artifactCounts).toEqual({ c1: 1, c2: 1 })
    expect(result.totalMessages).toBe(4)
    expect(result.totalArtifacts).toBe(2)
  })

  it('buckets weekly activity (last 7 days) with companion/textbook tallies', () => {
    const result = buildStatsOverview(baseInput())
    expect(result.week.messages).toBe(3)
    expect(result.week.artifacts).toBe(1)
    expect(result.week.companion).toEqual({ comp_a: 3 })
    expect(result.week.textbook).toEqual({ tb_1: 3 })
    expect(result.week.startKey).toBe(dayKey(weekStartOf(NOW)))
  })

  it('estimates study minutes per day, merging sessions within the gap', () => {
    const result = buildStatsOverview(baseInput())
    // 09:00–09:30 = 30 minutes; the lone 14:00 message adds no session time.
    expect(result.dailyMinutes[dayKey(TODAY)]).toBe(30 * 60 * 1000)
    expect(Object.keys(result.dailyMinutes)).toHaveLength(1)
    expect(result.week.ms).toBe(30 * 60 * 1000)
  })

  it('treats messages exactly at the week boundary as this week', () => {
    const boundary = weekStartOf(NOW).getTime()
    const result = buildStatsOverview(
      baseInput({
        conversations: [{ id: 'c1', companionId: 'comp_a', textbookId: null }],
        messagesByConversation: {
          c1: [
            { createdAt: new Date(boundary).toISOString() },
            { createdAt: new Date(boundary - 1).toISOString() }
          ]
        },
        artifactsByConversation: { c1: [] }
      })
    )
    expect(result.week.messages).toBe(1)
  })

  it('handles empty input', () => {
    const result = buildStatsOverview({
      conversations: [],
      messagesByConversation: {},
      artifactsByConversation: {},
      now: NOW
    })
    expect(result.totalMessages).toBe(0)
    expect(result.totalArtifacts).toBe(0)
    expect(result.dailyMinutes).toEqual({})
    expect(result.week).toMatchObject({ ms: 0, messages: 0, artifacts: 0 })
  })
})
