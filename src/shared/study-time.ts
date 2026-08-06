/**
 * Study-time estimation shared helpers (framework-free, testable).
 *
 * Study time is estimated from message timestamps: consecutive messages
 * within SESSION_GAP_MS form one session; each session's duration is the
 * span between its first and last message, capped at MAX_SESSION_MS so idle
 * time is never counted. Session minutes are bucketed per calendar day —
 * sessions crossing midnight are split across the days they actually span
 * (mirrors the original 2.1.1 fix "time now bucketed per actual day").
 */

/** Messages more than this far apart start a new study session. */
export const SESSION_GAP_MS = 45 * 60 * 1000
/** A single session is capped at 4 hours — idle time is not study time. */
export const MAX_SESSION_MS = 4 * 60 * 60 * 1000

export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Allocate session minutes to calendar days (cross-midnight sessions split). */
export function addSessionMinutes(
  perDay: Map<string, number>,
  start: number,
  end: number,
  maxSessionMs = MAX_SESSION_MS
): void {
  if (end <= start) return
  const duration = Math.min(end - start, maxSessionMs)
  const endMs = start + duration
  let cursor = new Date(start)
  while (cursor.getTime() < endMs) {
    const nextMidnight = new Date(cursor)
    nextMidnight.setHours(24, 0, 0, 0)
    const segEnd = Math.min(endMs, nextMidnight.getTime())
    const key = dayKey(cursor)
    perDay.set(key, (perDay.get(key) ?? 0) + (segEnd - cursor.getTime()))
    cursor = new Date(segEnd)
  }
}

/**
 * Estimate per-day study minutes from a conversation's message timestamps.
 * Returns a Map keyed by `YYYY-MM-DD` → milliseconds of estimated study time.
 */
export function estimateDailyStudyMinutes(
  timestamps: number[],
  gapMs = SESSION_GAP_MS,
  maxSessionMs = MAX_SESSION_MS
): Map<string, number> {
  const perDay = new Map<string, number>()
  const times = timestamps
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)

  let sessionStart: number | null = null
  let prev = -1
  for (const t of times) {
    if (sessionStart === null) {
      sessionStart = t
    } else if (t - prev > gapMs) {
      addSessionMinutes(perDay, sessionStart, prev, maxSessionMs)
      sessionStart = t
    }
    prev = t
  }
  if (sessionStart !== null && prev !== -1) {
    addSessionMinutes(perDay, sessionStart, prev, maxSessionMs)
  }
  return perDay
}

/** Current streak: consecutive days (ending today or yesterday) with study time. */
export function computeStreak(perDay: Map<string, number>): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cursor = new Date(today)
  if ((perDay.get(dayKey(cursor)) ?? 0) === 0) {
    cursor.setDate(cursor.getDate() - 1)
  }
  let streak = 0
  while ((perDay.get(dayKey(cursor)) ?? 0) > 0) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export interface HeatCell {
  key: string
  minutes: number
}

/** Last 365 days aligned to a Sunday, grouped into weeks (heatmap columns). */
export function buildHeatmapWeeks(perDay: Map<string, number>): HeatCell[][] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - 364)
  while (start.getDay() !== 0) start.setDate(start.getDate() - 1)

  const weeks: HeatCell[][] = []
  const cursor = new Date(start)
  while (cursor.getTime() <= today.getTime()) {
    const week: HeatCell[] = []
    for (let i = 0; i < 7; i++) {
      const key = dayKey(cursor)
      week.push({ key, minutes: perDay.get(key) ?? 0 })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}
