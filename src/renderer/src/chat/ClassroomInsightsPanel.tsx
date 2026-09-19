/**
 * 课堂实时学情面板：展示当前课堂已识别概念与掌握度（薄弱优先），
 * 数据由 `useConversationConcepts` 在每轮问答后实时刷新。
 */
import { masteryTier } from '../../../shared/concept-mastery'

interface ClassroomInsightsPanelProps {
  conversationId: string | null
  concepts: ConceptStateDTO[]
}

const TIER_STYLE: Record<'掌握' | '理解' | '薄弱', { badge: string; bar: string }> = {
  掌握: { badge: 'bg-green-900/30 text-green-500', bar: 'bg-green-500' },
  理解: { badge: 'bg-accent-subtle text-accent-hover', bar: 'bg-accent' },
  薄弱: { badge: 'bg-red-900/30 text-red-400', bar: 'bg-red-500' }
}

export function ClassroomInsightsPanel({
  conversationId,
  concepts
}: ClassroomInsightsPanelProps): React.ReactElement {
  const sorted = [...concepts].sort((a, b) => a.mastery - b.mastery)
  const counts = { 薄弱: 0, 理解: 0, 掌握: 0 }
  for (const c of sorted) counts[masteryTier(c.mastery)]++

  return (
    <div
      role="region"
      aria-label="实时学情"
      className="border-b border-surface-border bg-bg-deep/60 px-6 py-3"
    >
      {!conversationId ? (
        <p className="text-xs text-text-muted">开始对话后，这里会实时显示本节的概念掌握情况。</p>
      ) : concepts.length === 0 ? (
        <p className="text-xs text-text-muted">本节尚未识别到概念；答疑过程中会实时更新。</p>
      ) : (
        <>
          <p className="text-xs text-text-secondary">
            已识别 {sorted.length} 个概念：薄弱 {counts.薄弱} · 基本理解 {counts.理解} · 已掌握 {counts.掌握}
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {sorted.map((c) => {
              const tier = masteryTier(c.mastery)
              const style = TIER_STYLE[tier]
              return (
                <div
                  key={`${c.id}:${c.textbookId ?? ''}`}
                  className="rounded-lg border border-surface-border bg-bg-surface px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-text-primary">{c.name}</span>
                    <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${style.badge}`}>
                      {tier} · {Math.round(c.mastery * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-elevated">
                    <div
                      className={`h-full rounded-full ${style.bar}`}
                      style={{ width: `${Math.max(4, c.mastery * 100)}%` }}
                    />
                  </div>
                  {c.misconception && (
                    <p className="mt-1.5 text-[10px] leading-relaxed text-amber-500">
                      ⚠️ 误解点：{c.misconception}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
