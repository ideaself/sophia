import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { useCompanionStore } from '../stores/useCompanionStore'
import { useTextbookStore } from '../stores/useTextbookStore'
import { parseSelfTestQuestions } from '../../../shared/self-test-utils'
import { buildNextSteps } from '../../../shared/next-steps'
import { parseTimeline, parseFaq } from '../../../shared/lesson-media'
import { FlashcardReviewView } from './FlashcardReviewView'
import { SelfTestBlock } from './SelfTestBlock'
import { AudioReviewPlayer } from './AudioReviewPlayer'

const MarkdownRenderer = lazy(() => import('../lib/MarkdownRenderer'))

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

type ReviewTab = 'summary' | 'selftest' | 'flashcards' | 'diary' | 'progress' | 'feynman' | 'knowledge' | 'concepts' | 'next' | 'audio' | 'timeline' | 'faq'

/**
 * 课程复盘视图 —— 把一节已下课课堂的产物整合成一页：
 * 课堂总结 / 自测题 / 记忆卡片 / 学习日记 / 学习进展 / 费曼知识蛋。
 */
export function ReviewView(): React.ReactElement {
  const scope = useAppStore((s) => s.reviewScope)
  const setView = useAppStore((s) => s.setView)
  const setReviewScope = useAppStore((s) => s.setReviewScope)
  const setLoadConversationId = useAppStore((s) => s.setLoadConversationId)
  const setSelectedCompanion = useCompanionStore((s) => s.select)
  const setSelectedTextbook = useTextbookStore((s) => s.select)

  const [tab, setTab] = useState<ReviewTab>('summary')
  const [messages, setMessages] = useState<MessageDTO[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactDTO[]>([])
  const [concepts, setConcepts] = useState<ConceptStateDTO[]>([])
  const [companionName, setCompanionName] = useState('')
  const [textbookTitle, setTextbookTitle] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!scope) return
    setLoading(true)
    try {
      const conv = await window.sophia.data.getConversation(scope.conversationId)
      const [msgs, arts] = await Promise.all([
        window.sophia.data.listMessages(scope.conversationId).catch(() => [] as MessageDTO[]),
        window.sophia.data.listArtifacts(scope.conversationId).catch(() => [] as ArtifactDTO[])
      ])
      const cps = await window.sophia.data.listConcepts(scope.conversationId).catch(() => [] as ConceptStateDTO[])
      setConcepts(cps)
      if (conv) {
        const comp = conv.companionId ? await window.sophia.companions.get(conv.companionId).catch(() => null) : null
        setCompanionName(comp?.name ?? conv.companionId)
        if (conv.textbookId) {
          const tb = await window.sophia.data.getTextbook(conv.textbookId).catch(() => null)
          setTextbookTitle(tb?.title ?? '')
        }
      }
      setMessages(msgs)
      setArtifacts(arts)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    void load()
  }, [load])

  // 课堂对话中概念掌握度增量更新 → 实时刷新本 tab
  useEffect(() => {
    return window.sophia.data.onConceptsUpdated(({ conversationId }) => {
      if (conversationId === scope?.conversationId) {
        void window.sophia.data.listConcepts(conversationId).then(setConcepts).catch(() => {})
      }
    })
  }, [scope?.conversationId])

  if (!scope) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        没有选择要复盘的课堂
      </div>
    )
  }

  const art = (type: string) => artifacts.find((a) => a.type === type)?.content
  const selfTestQuestions = parseSelfTestQuestions(art('lesson_summary') ?? '')

  const TABS: Array<{ key: ReviewTab; label: string; show: boolean }> = [
    { key: 'summary', label: '课堂总结', show: !!art('lesson_summary') },
    { key: 'selftest', label: `自测题${selfTestQuestions.length ? ` (${selfTestQuestions.length})` : ''}`, show: selfTestQuestions.length > 0 },
    { key: 'flashcards', label: '记忆卡片', show: !!art('flashcards') },
    { key: 'diary', label: '学习日记', show: !!art('diary') },
    { key: 'progress', label: '学习进展', show: !!art('progress') },
    { key: 'knowledge', label: '🧠 知识点图谱', show: !!art('knowledge_graph') },
    { key: 'concepts', label: '📊 概念掌握', show: concepts.length > 0 },
    { key: 'next', label: '🎯 下一步建议', show: concepts.length > 0 },
    { key: 'audio', label: '🎧 音频回顾', show: !!art('lesson_audio') },
    { key: 'timeline', label: '🕐 课堂时间线', show: !!art('lesson_timeline') },
    { key: 'faq', label: '❓ 课堂 FAQ', show: !!art('lesson_faq') },
    { key: 'feynman', label: '费曼知识蛋', show: !!art('feynman_note') }
  ]
  const visibleTabs = TABS.filter((t) => t.show)
  const activeTab = visibleTabs.find((t) => t.key === tab) ?? visibleTabs[0]
  const currentKey = activeTab?.key ?? 'summary'

  const startDate = messages.length > 0 ? new Date(messages[0].createdAt).toLocaleString() : ''
  const endDate = messages.length > 0 ? new Date(messages[messages.length - 1].createdAt).toLocaleString() : ''

  const handleContinueLearning = async () => {
    /* v8 ignore next -- @preserve */
    if (scope) {
      try {
        const conv = await window.sophia.data.getConversation(scope.conversationId)
        if (conv?.companionId) {
          const comp = await window.sophia.companions.get(conv.companionId).catch(() => null)
          if (comp) setSelectedCompanion({ id: comp.id, name: comp.name, identity: comp.identity, personalityKeywords: comp.personalityKeywords })
        }
        if (conv?.textbookId) {
          const tb = await window.sophia.data.getTextbook(conv.textbookId).catch(() => null)
          if (tb) setSelectedTextbook({ id: tb.id, title: tb.title, format: tb.format, originalFile: tb.originalFile })
        } else {
          setSelectedTextbook(null)
        }
      } catch { /* keep current selection */ }
    }
    setReviewScope(null)
    setLoadConversationId(null)
    useAppStore.getState().beginNewClassroom()
    setView('classroom')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-surface-border bg-bg-surface px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{scope.title}</h2>
            <p className="mt-1 text-xs text-text-muted">
              {companionName && `${companionName} · `}
              {textbookTitle && `${textbookTitle} · `}
              {startDate && `${startDate} — ${endDate}`}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              onClick={handleContinueLearning}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
              title="同一本教材、同一位伙伴开一节新课堂"
            >
              继续学习
            </button>
            <button
              onClick={() => { setReviewScope(null); setView('history') }}
              className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-muted hover:bg-bg-elevated"
            >
              返回历史
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div className="mt-3 flex flex-wrap gap-1">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                currentKey === t.key
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <p className="text-text-muted">加载中...</p>
        ) : currentKey === 'summary' ? (
          <div className="markdown-body max-w-3xl">
            <Suspense fallback={null}>
              <MarkdownRenderer>{art('lesson_summary') ?? ''}</MarkdownRenderer>
            </Suspense>
          </div>
        ) : currentKey === 'selftest' ? (
          <div className="max-w-3xl">
            <SelfTestBlock questions={selfTestQuestions} />
          </div>
        ) : currentKey === 'flashcards' ? (
          <FlashcardReviewView
            scope={{ conversationId: scope.conversationId, title: scope.title }}
            onClearScope={() => setTab('summary')}
          />
        ) : currentKey === 'diary' ? (
          <div className="markdown-body max-w-3xl">
            <Suspense fallback={null}>
              <MarkdownRenderer>
                {
                  // v8 ignore next -- @preserve
                  art('diary') ?? ''
                }
              </MarkdownRenderer>
            </Suspense>
          </div>
        ) : currentKey === 'progress' ? (
          <div className="markdown-body max-w-3xl">
            <Suspense fallback={null}>
              <MarkdownRenderer>
                {
                  // v8 ignore next -- @preserve
                  art('progress') ?? ''
                }
              </MarkdownRenderer>
            </Suspense>
          </div>
        ) : currentKey === 'knowledge' ? (
          <div className="markdown-body max-w-3xl">
            <Suspense fallback={null}>
              <MarkdownRenderer>
                {
                  // v8 ignore next -- @preserve
                  art('knowledge_graph') ?? ''
                }
              </MarkdownRenderer>
            </Suspense>
          </div>
        ) : currentKey === 'concepts' ? (
          <ConceptStateList concepts={concepts} />
        ) : currentKey === 'next' ? (
          <NextStepsPanel concepts={concepts} />
        ) : currentKey === 'audio' ? (
          <AudioReviewPlayer
            content={
              // v8 ignore next -- @preserve
              art('lesson_audio') ?? ''
            }
          />
        ) : currentKey === 'timeline' ? (
          <TimelinePanel
            content={
              // v8 ignore next -- @preserve
              art('lesson_timeline') ?? ''
            }
          />
        ) : currentKey === 'faq' ? (
          <FaqPanel
            content={
              // v8 ignore next -- @preserve
              art('lesson_faq') ?? ''
            }
          />
        ) : (
          <div className="markdown-body max-w-3xl">
            <Suspense fallback={null}>
              <MarkdownRenderer>
                {
                  // v8 ignore next -- @preserve
                  art('feynman_note') ?? ''
                }
              </MarkdownRenderer>
            </Suspense>
          </div>
        )}
      </div>
    </div>
  )
}

/** 概念掌握度四档标签与颜色。 */
function masteryLevel(m: number): { label: string; bar: string; text: string } {
  if (m >= 0.75) return { label: '掌握', bar: 'bg-green-500', text: 'text-green-600' }
  if (m >= 0.5) return { label: '理解', bar: 'bg-accent', text: 'text-accent' }
  if (m >= 0.25) return { label: '薄弱', bar: 'bg-amber-500', text: 'text-amber-700' }
  return { label: '未接触', bar: 'bg-bg-elevated', text: 'text-text-muted' }
}

/** 复盘页「概念掌握」：本课涉及概念的增量识别结果与累计掌握度。 */
function ConceptStateList({ concepts }: { concepts: ConceptStateDTO[] }): React.ReactElement {
  /* v8 ignore next -- @preserve */
  if (concepts.length === 0) {
    return (
      <div className="max-w-3xl rounded-xl border border-surface-border bg-bg-surface p-6 text-center text-sm text-text-muted">
        本课尚未积累概念状态。课堂对话会实时识别涉及的概念与掌握表现。
      </div>
    )
  }
  const sorted = [...concepts].sort((a, b) => b.mastery - a.mastery)
  return (
    <div className="max-w-3xl space-y-3">
      {sorted.map((c) => {
        const level = masteryLevel(c.mastery)
        return (
          <div key={c.id} className="rounded-xl border border-surface-border bg-bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-text-primary">{c.name}</span>
              <span className={`flex-shrink-0 rounded-full bg-bg-elevated px-2 py-0.5 text-[10px] font-medium ${level.text}`}>
                {level.label} · {Math.round(c.mastery * 100)}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-elevated">
              <div className={`h-full rounded-full ${level.bar}`} style={{ width: `${Math.max(4, c.mastery * 100)}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
              <span>尝试 {c.attemptCount} 次 · 答对 {c.correctCount} 次</span>
              <span>最近接触 {new Date(c.lastSeenAt).toLocaleString()}</span>
            </div>
            {c.misconception && (
              <p className="mt-2 rounded-lg border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-xs leading-relaxed text-text-secondary">
                ⚠️ 误解点：{c.misconception}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 下一步建议（里程碑 3）：按掌握度档位生成行动卡片，规则驱动、零 LLM。 */
function NextStepsPanel({ concepts }: { concepts: ConceptStateDTO[] }): React.ReactElement {
  const steps = buildNextSteps(concepts)
  const styleOf: Record<string, { frame: string; badge: string }> = {
    薄弱: { frame: 'border-red-800/40', badge: 'bg-red-900/30 text-red-400' },
    理解: { frame: 'border-amber-700/40', badge: 'bg-amber-900/30 text-amber-500' },
    掌握: { frame: 'border-green-800/40', badge: 'bg-green-900/30 text-green-400' },
    目标: { frame: 'border-accent-border', badge: 'bg-accent/20 text-accent' }
  }
  return (
    <div className="max-w-3xl space-y-3">
      {steps.map((s, i) => {
        const st = styleOf[s.tier]
        return (
          <div key={i} className={`rounded-xl border ${st.frame} bg-bg-surface p-4`}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-text-primary">{s.title}</span>
              <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${st.badge}`}>
                {s.tier}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{s.action}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {s.concepts.map((n) => (
                <span key={n} className="rounded-full bg-bg-elevated px-2 py-0.5 text-xs text-text-muted">
                  {n}
                </span>
              ))}
            </div>
          </div>
        )
      })}
      <p className="text-xs text-text-muted">
        建议由概念掌握度自动生成；在课堂开场用「🎯 下一步建议」里列出的薄弱概念优先复习。
      </p>
    </div>
  )
}

/** 课堂时间线（里程碑 4）：竖向时间轴渲染。 */
function TimelinePanel({ content }: { content: string }): React.ReactElement {
  const events = parseTimeline(content)
  if (events.length === 0) {
    return (
      <div className="max-w-3xl rounded-xl border border-surface-border bg-bg-surface p-4 text-sm text-text-muted">
        {
          // v8 ignore next -- @preserve
          content || '本课未生成时间线。'
        }
      </div>
    )
  }
  return (
    <div className="max-w-3xl">
      <ol className="relative space-y-4 border-l border-surface-border-strong pl-5">
        {events.map((e, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full bg-accent" />
            <p className="text-xs font-medium text-accent">{e.time}</p>
            <p className="mt-0.5 text-sm font-medium text-text-primary">{e.name}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-text-secondary">{e.description}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 课堂 FAQ（里程碑 4）：点击展开的问答卡。 */
function FaqPanel({ content }: { content: string }): React.ReactElement {
  const entries = parseFaq(content)
  const [open, setOpen] = useState<number | null>(0)
  if (entries.length === 0) {
    return (
      <div className="max-w-3xl rounded-xl border border-surface-border bg-bg-surface p-4 text-sm text-text-muted">
        {
          // v8 ignore next -- @preserve
          content || '本课未生成 FAQ。'
        }
      </div>
    )
  }
  return (
    <div className="max-w-3xl space-y-2">
      {entries.map((e, i) => {
        const isOpen = open === i
        return (
          <div key={i} className="overflow-hidden rounded-xl border border-surface-border bg-bg-surface">
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="text-sm font-medium text-text-primary">Q{i + 1}. {e.question}</span>
              <span className="flex-shrink-0 text-xs text-text-muted">{isOpen ? '▴' : '▾'}</span>
            </button>
            {isOpen && (
              <p className="border-t border-surface-border px-4 py-3 text-sm leading-relaxed text-text-secondary">
                {e.answer}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
