import { useState, useEffect } from 'react'
import { WORLD_ID } from '../types/models'
import {
  estimateDailyStudyMinutes,
  computeStreak,
  buildHeatmapWeeks,
  dayKey
} from '../../../shared/study-time'

interface ConversationDTO {
  id: string
  title: string
  companionId: string
  textbookId: string | null
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

interface MessageDTO {
  id: string
  role: string
  content: string
  createdAt: string
}

interface ArtifactDTO {
  id: string
  type: string
  content: string
  createdAt: string
}

interface WeekStats {
  minutes: number
  messages: number
  artifacts: number
  companion: Record<string, number>
  textbook: Record<string, number>
}

function perDay(map: Map<string, number>, key: string): number {
  return map.get(key) ?? 0
}

function heatColor(minutes: number): string {
  if (minutes <= 0) return 'var(--bg-elevated)'
  if (minutes < 15 * 60 * 1000) return 'rgba(37, 99, 235, 0.35)'
  if (minutes < 45 * 60 * 1000) return 'rgba(37, 99, 235, 0.6)'
  if (minutes < 90 * 60 * 1000) return 'rgba(37, 99, 235, 0.8)'
  return 'var(--accent)'
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000)
  if (totalMinutes < 60) return `${totalMinutes} 分钟`
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
}

export function StatsView(): React.ReactElement {
  const [conversations, setConversations] = useState<ConversationDTO[]>([])
  const [totalMessages, setTotalMessages] = useState(0)
  const [totalArtifacts, setTotalArtifacts] = useState(0)
  const [totalMinutes, setTotalMinutes] = useState(0)
  const [streak, setStreak] = useState(0)
  const [dailyMinutes, setDailyMinutes] = useState<Map<string, number>>(new Map())
  const [companionUsage, setCompanionUsage] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [companionNames, setCompanionNames] = useState<Record<string, string>>({})
  const [textbookTitles, setTextbookTitles] = useState<Record<string, string>>({})
  const [weekStats, setWeekStats] = useState<WeekStats | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const convs = await window.sophia.data.listConversations(WORLD_ID) as ConversationDTO[]
        setConversations(convs)

        const weekStart = new Date()
        weekStart.setHours(0, 0, 0, 0)
        weekStart.setDate(weekStart.getDate() - 6)
        const weekStartMs = weekStart.getTime()
        const weekStartKey = dayKey(weekStart)

        let msgCount = 0
        let artCount = 0
        const usage: Record<string, number> = {}
        const perDay = new Map<string, number>()

        let wkMsgs = 0
        let wkArts = 0
        const wkCompanion: Record<string, number> = {}
        const wkTextbook: Record<string, number> = {}

        for (const conv of convs) {
          usage[conv.companionId] = (usage[conv.companionId] ?? 0) + 1
        }

        // Load messages and artifacts for all conversations in parallel
        await Promise.all(
          convs.map(async (conv) => {
            const [msgs, arts] = await Promise.all([
              window.sophia.data.listMessages(conv.id).catch(() => [] as MessageDTO[]),
              window.sophia.data.listArtifacts(conv.id).catch(() => [] as ArtifactDTO[])
            ])
            msgCount += msgs.length
            artCount += arts.length

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
            wkArts += arts.filter((a) => new Date(a.createdAt).getTime() >= weekStartMs).length

            const convPerDay = estimateDailyStudyMinutes(times)
            for (const [key, ms] of convPerDay) {
              perDay.set(key, (perDay.get(key) ?? 0) + ms)
            }
          })
        )

        let wkMinutes = 0
        for (const [key, ms] of perDay) {
          if (key >= weekStartKey) wkMinutes += ms
        }

        setTotalMessages(msgCount)
        setTotalArtifacts(artCount)
        setCompanionUsage(usage)
        setDailyMinutes(perDay)
        setWeekStats({ minutes: wkMinutes, messages: wkMsgs, artifacts: wkArts, companion: wkCompanion, textbook: wkTextbook })

        // Load textbook titles for the weekly report distribution
        try {
          const tbs = await window.sophia.data.listTextbooks(WORLD_ID)
          setTextbookTitles(Object.fromEntries(tbs.map((tb) => [tb.id, tb.title])))
        } catch {
          setTextbookTitles({})
        }
        setTotalMinutes([...perDay.values()].reduce((a, b) => a + b, 0))
        setStreak(computeStreak(perDay))

        const ids = [...new Set(convs.map((c) => c.companionId))]
        const namePairs = await Promise.all(
          ids.map(async (id) => {
            const comp = await window.sophia.companions.get(id)
            return [id, comp?.name ?? '未知'] as const
          })
        )
        setCompanionNames(Object.fromEntries(namePairs))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-text-muted">加载统计数据...</p>
      </div>
    )
  }

  const endedCount = conversations.filter((c) => c.endedAt).length
  const activeCount = conversations.length - endedCount

  const last14 = (() => {
    const out: Array<{ key: string; minutes: number }> = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      out.push({ key, minutes: perDay(dailyMinutes, key) })
    }
    return out
  })()

  const maxDaily = Math.max(...last14.map((d) => d.minutes), 1)
  const heatmapWeeks = buildHeatmapWeeks(dailyMinutes)

  const sortedCompanions = Object.entries(companionUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  // ---- 本周报告 ----
  const dateLabel = (d: Date): string => `${d.getMonth() + 1}月${d.getDate()}日`
  const weekStartDate = (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - 6)
    return d
  })()
  const weekLabel = `${dateLabel(weekStartDate)} ~ ${dateLabel(new Date())}`

  const topDist = (dist: Record<string, number>, nameOf: (key: string) => string, top = 3): Array<[string, number, number]> => {
    const total = Object.values(dist).reduce((a, b) => a + b, 0)
    if (total === 0) return []
    return Object.entries(dist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([k, n]) => [nameOf(k), n, Math.round((n / total) * 100)] as [string, number, number])
  }
  const tbDist = weekStats ? topDist(weekStats.textbook, (k) => k === 'none' ? '未绑定教材' : (textbookTitles[k] ?? '未知教材')) : []
  const compDist = weekStats ? topDist(weekStats.companion, (k) => companionNames[k] ?? k) : []

  const exportWeeklyReport = async () => {
    if (!weekStats) return
    const result = await window.sophia.dialog.saveFile({
      defaultPath: `学习周报_${new Date().toISOString().slice(0, 10)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return

    const distLines = (dist: Array<[string, number, number]>): string[] =>
      dist.map(([name, n, pct]) => `- ${name}：${n} 条（${pct}%）`)
    const lines = [
      `# 学习周报（${weekLabel}）`,
      '',
      `- 学习时长：${formatDuration(weekStats.minutes * 60000)}`,
      `- 消息数：${weekStats.messages}`,
      `- 学习产物：${weekStats.artifacts}`,
      `- 连续学习天数：${streak}`,
      '',
      '## 按教材',
      ...(tbDist.length > 0 ? distLines(tbDist) : ['（无）']),
      '',
      '## 按角色',
      ...(compDist.length > 0 ? distLines(compDist) : ['（无）'])
    ]
    await window.sophia.data.writeTextFile(result.filePath, lines.join('\n'))
  }

  return (
    <div className="p-8">
      <h2 className="mb-6 text-2xl font-bold">学习统计</h2>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-surface-border bg-bg-surface p-4">
          <p className="text-3xl font-bold text-accent">{conversations.length}</p>
          <p className="mt-1 text-sm text-text-muted">总课堂数</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-bg-surface p-4">
          <p className="text-3xl font-bold text-green-400">{endedCount}</p>
          <p className="mt-1 text-sm text-text-muted">已完成</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-bg-surface p-4">
          <p className="text-3xl font-bold text-amber-400">{formatDuration(totalMinutes)}</p>
          <p className="mt-1 text-sm text-text-muted">累计学习时长</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-bg-surface p-4">
          <p className="text-3xl font-bold text-orange-400">{streak}</p>
          <p className="mt-1 text-sm text-text-muted">连续学习天数</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-bg-surface p-4">
          <p className="text-3xl font-bold text-purple-400">{totalMessages}</p>
          <p className="mt-1 text-sm text-text-muted">总消息数</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-bg-surface p-4">
          <p className="text-3xl font-bold text-emerald-400">{totalArtifacts}</p>
          <p className="mt-1 text-sm text-text-muted">学习产物</p>
        </div>
      </div>

      {/* Weekly report */}
      {weekStats && (
        <div className="mb-8 rounded-xl border border-surface-border bg-bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">本周报告</h3>
              <p className="mt-0.5 text-xs text-text-muted">{weekLabel} · 近 7 天</p>
            </div>
            <button
              onClick={() => void exportWeeklyReport()}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
            >
              导出 Markdown
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-2xl font-bold text-accent">{formatDuration(weekStats.minutes * 60000)}</p>
              <p className="mt-0.5 text-xs text-text-muted">学习时长</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{weekStats.messages}</p>
              <p className="mt-0.5 text-xs text-text-muted">消息数</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{weekStats.artifacts}</p>
              <p className="mt-0.5 text-xs text-text-muted">学习产物</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-orange-400">{streak}</p>
              <p className="mt-0.5 text-xs text-text-muted">连续学习天数</p>
            </div>
          </div>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium text-text-muted">按教材（消息数）</p>
              {tbDist.length === 0 ? (
                <p className="text-xs text-text-muted">本周暂无学习</p>
              ) : (
                <div className="space-y-1.5">
                  {tbDist.map(([name, n, pct]) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="w-32 truncate text-xs text-text-secondary" title={name}>{name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-elevated">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-16 text-right text-[10px] text-text-muted">{n} 条 · {pct}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-text-muted">按角色（消息数）</p>
              {compDist.length === 0 ? (
                <p className="text-xs text-text-muted">本周暂无学习</p>
              ) : (
                <div className="space-y-1.5">
                  {compDist.map(([name, n, pct]) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="w-32 truncate text-xs text-text-secondary" title={name}>{name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-elevated">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-16 text-right text-[10px] text-text-muted">{n} 条 · {pct}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Daily activity (minutes) */}
        <div className="rounded-xl border border-surface-border bg-bg-surface p-6">
          <h3 className="mb-4 text-lg font-semibold">近 14 天学习时长</h3>
          {last14.every((d) => d.minutes === 0) ? (
            <p className="text-text-muted">暂无数据</p>
          ) : (
            <div className="flex items-end gap-1" style={{ height: '120px' }}>
              {last14.map((d) => (
                <div key={d.key} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-accent transition-all"
                    style={{ height: `${(d.minutes / maxDaily) * 100}%`, minHeight: '4px' }}
                    title={`${d.key}: ${formatDuration(d.minutes)}`}
                  />
                  <span className="text-[9px] text-text-muted">{d.key.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Yearly heatmap */}
        <div className="rounded-xl border border-surface-border bg-bg-surface p-6">
          <h3 className="mb-4 text-lg font-semibold">年度学习热力图</h3>
          <div className="overflow-x-auto">
            <div
              className="grid gap-[3px]"
              style={{
                gridTemplateRows: 'repeat(7, 12px)',
                gridAutoFlow: 'column',
                gridAutoColumns: '12px'
              }}
            >
              {heatmapWeeks.flatMap((week, wi) =>
                week.map((cell, di) => (
                  <div
                    key={`${wi}-${di}`}
                    className="h-3 w-3 rounded-[2px]"
                    style={{ background: heatColor(cell.minutes) }}
                    title={`${cell.key}: ${formatDuration(cell.minutes)}`}
                  />
                ))
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-text-muted">
            颜色越深表示当天学习越久（基于消息时间估算，跨天会话按天拆分）
          </p>
        </div>

        {/* Companion usage */}
        <div className="rounded-xl border border-surface-border bg-bg-surface p-6">
          <h3 className="mb-4 text-lg font-semibold">角色使用排行</h3>
          {sortedCompanions.length === 0 ? (
            <p className="text-text-muted">暂无数据</p>
          ) : (
            <div className="space-y-3">
              {sortedCompanions.map(([id, count], idx) => {
                const maxCount = sortedCompanions[0][1]
                const pct = (count / maxCount) * 100
                return (
                  <div key={id} className="flex items-center gap-3">
                    <span className="w-5 text-sm text-text-muted">{idx + 1}</span>
                    <div className="flex-1">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm text-text-secondary">{companionNames[id] ?? id}</span>
                        <span className="text-xs text-text-muted">{count} 次</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-bg-elevated">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {activeCount > 0 && (
        <p className="mt-6 text-sm text-text-muted">
          当前有 {activeCount} 个进行中的课堂
        </p>
      )}
    </div>
  )
}
