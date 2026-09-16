/**
 * Stats aggregation for the renderer views (本周报告 / 历史列表).
 *
 * Both views used to pull EVERY message of EVERY conversation over IPC just
 * to count and bucket them. The aggregation now runs in the main process and
 * ships a small summary object instead.
 */

import { estimateDailyStudyMinutes, dayKey } from '../../shared/study-time'

export interface StatsOverviewInput {
  conversations: Array<{
    id: string
    companionId: string
    textbookId: string | null
  }>
  /** Per-conversation messages — only `createdAt` is used. */
  messagesByConversation: Record<string, Array<{ createdAt: string }>>
  /** Per-conversation artifacts — only `createdAt` is used. */
  artifactsByConversation: Record<string, Array<{ createdAt: string }>>
  /** Reference "now" (injected for testability). */
  now: Date
}

export interface StatsOverview {
  messageCounts: Record<string, number>
  artifactCounts: Record<string, number>
  totalMessages: number
  totalArtifacts: number
  /** dayKey → estimated study ms, all time (same semantics as the stats view). */
  dailyMinutes: Record<string, number>
  week: {
    startKey: string
    ms: number
    messages: number
    artifacts: number
    companion: Record<string, number>
    textbook: Record<string, number>
  }
}

/** Last-7-days window (today included), local midnight boundaries. */
export function weekStartOf(now: Date): Date {
  const weekStart = new Date(now)
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() - 6)
  return weekStart
}

export function buildStatsOverview(input: StatsOverviewInput): StatsOverview {
  const weekStart = weekStartOf(input.now)
  const weekStartMs = weekStart.getTime()
  const weekStartKey = dayKey(weekStart)

  const messageCounts: Record<string, number> = {}
  const artifactCounts: Record<string, number> = {}
  const wkCompanion: Record<string, number> = {}
  const wkTextbook: Record<string, number> = {}
  const perDay = new Map<string, number>()

  let totalMessages = 0
  let totalArtifacts = 0
  let wkMsgs = 0
  let wkArts = 0

  for (const conv of input.conversations) {
    const msgs = input.messagesByConversation[conv.id] ?? []
    const arts = input.artifactsByConversation[conv.id] ?? []

    messageCounts[conv.id] = msgs.length
    artifactCounts[conv.id] = arts.length
    totalMessages += msgs.length
    totalArtifacts += arts.length

    const times: number[] = []
    for (const m of msgs) {
      const t = new Date(m.createdAt).getTime()
      if (!Number.isFinite(t)) continue
      times.push(t)
      if (t >= weekStartMs) {
        wkMsgs++
        wkCompanion[conv.companionId] = (wkCompanion[conv.companionId] ?? 0) + 1
        const tbKey = conv.textbookId ?? 'none'
        wkTextbook[tbKey] = (wkTextbook[tbKey] ?? 0) + 1
      }
    }
    for (const a of arts) {
      const t = new Date(a.createdAt).getTime()
      if (Number.isFinite(t) && t >= weekStartMs) wkArts++
    }

    // Per-conversation sessions, merged across conversations (same as the
    // renderer's previous inline loop).
    const convPerDay = estimateDailyStudyMinutes(times)
    for (const [key, ms] of convPerDay) {
      perDay.set(key, (perDay.get(key) ?? 0) + ms)
    }
  }

  let weekMs = 0
  for (const [key, ms] of perDay) {
    if (key >= weekStartKey) weekMs += ms
  }

  return {
    messageCounts,
    artifactCounts,
    totalMessages,
    totalArtifacts,
    dailyMinutes: Object.fromEntries(perDay),
    week: {
      startKey: weekStartKey,
      ms: weekMs,
      messages: wkMsgs,
      artifacts: wkArts,
      companion: wkCompanion,
      textbook: wkTextbook
    }
  }
}
