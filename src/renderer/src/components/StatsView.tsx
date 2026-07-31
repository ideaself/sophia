import { useState, useEffect } from 'react'
import { WORLD_ID } from '../types/models'

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

interface CompanionDTO {
  id: string
  name: string
  identity: string
}

export function StatsView(): React.ReactElement {
  const [conversations, setConversations] = useState<ConversationDTO[]>([])
  const [totalMessages, setTotalMessages] = useState(0)
  const [totalArtifacts, setTotalArtifacts] = useState(0)
  const [companionUsage, setCompanionUsage] = useState<Record<string, number>>({})
  const [dailyActivity, setDailyActivity] = useState<Array<{ date: string; count: number }>>([])
  const [loading, setLoading] = useState(true)
  const [companionNames, setCompanionNames] = useState<Record<string, string>>({})

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const convs = await window.sophia.data.listConversations(WORLD_ID) as ConversationDTO[]
        setConversations(convs)

        let msgCount = 0
        let artCount = 0
        const usage: Record<string, number> = {}
        const dailyMap: Record<string, number> = {}

        for (const conv of convs) {
          usage[conv.companionId] = (usage[conv.companionId] ?? 0) + 1

          const date = new Date(conv.createdAt).toLocaleDateString('zh-CN')
          dailyMap[date] = (dailyMap[date] ?? 0) + 1
        }

        // Parallel-load messages and artifacts for all conversations
        const counts = await Promise.all(
          convs.map(async (conv) => {
            const [msgs, arts] = await Promise.all([
              window.sophia.data.listMessages(conv.id).then((m) => (m as MessageDTO[]).length).catch(() => 0),
              window.sophia.data.listArtifacts(conv.id).then((a) => (a as ArtifactDTO[]).length).catch(() => 0)
            ])
            return { msgs, arts }
          })
        )
        for (const c of counts) {
          msgCount += c.msgs
          artCount += c.arts
        }

        setTotalMessages(msgCount)
        setTotalArtifacts(artCount)
        setCompanionUsage(usage)

        const daily = Object.entries(dailyMap)
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-14)
        setDailyActivity(daily)

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
  const maxDaily = Math.max(...dailyActivity.map((d) => d.count), 1)

  const sortedCompanions = Object.entries(companionUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  return (
    <div className="p-8">
      <h2 className="mb-6 text-2xl font-bold">学习统计</h2>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-surface-border bg-bg-surface p-4">
          <p className="text-3xl font-bold text-accent">{conversations.length}</p>
          <p className="mt-1 text-sm text-text-muted">总课堂数</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-bg-surface p-4">
          <p className="text-3xl font-bold text-green-400">{endedCount}</p>
          <p className="mt-1 text-sm text-text-muted">已完成</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-bg-surface p-4">
          <p className="text-3xl font-bold text-amber-400">{totalMessages}</p>
          <p className="mt-1 text-sm text-text-muted">总消息数</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-bg-surface p-4">
          <p className="text-3xl font-bold text-purple-400">{totalArtifacts}</p>
          <p className="mt-1 text-sm text-text-muted">学习产物</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Daily activity */}
        <div className="rounded-xl border border-surface-border bg-bg-surface p-6">
          <h3 className="mb-4 text-lg font-semibold">近 14 天活跃度</h3>
          {dailyActivity.length === 0 ? (
            <p className="text-text-muted">暂无数据</p>
          ) : (
            <div className="flex items-end gap-1" style={{ height: '120px' }}>
              {dailyActivity.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-accent transition-all"
                    style={{ height: `${(d.count / maxDaily) * 100}%`, minHeight: '4px' }}
                    title={`${d.date}: ${d.count} 次`}
                  />
                  <span className="text-[9px] text-text-muted">{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
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
