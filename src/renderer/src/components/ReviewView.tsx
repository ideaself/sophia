import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../stores/useAppStore'
import { useCompanionStore } from '../stores/useCompanionStore'
import { useTextbookStore } from '../stores/useTextbookStore'
import { WORLD_ID } from '../types/models'
import { parseSelfTestQuestions, type SelfTestQuestion } from '../../../shared/self-test-utils'
import { FlashcardReviewView } from './FlashcardReviewView'

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

type ReviewTab = 'summary' | 'selftest' | 'flashcards' | 'diary' | 'progress' | 'feynman'

/** 逐级揭晓自测题（提示1 → 提示2 → 答案）。 */
function SelfTestBlock({ questions }: { questions: SelfTestQuestion[] }): React.ReactElement {
  const [revealed, setRevealed] = useState<Record<number, number>>({})

  const nextLabel = (i: number) => {
    const r = revealed[i] ?? 0
    const q = questions[i]
    if (r === 0) return '显示提示 1'
    if (r <= q.hints.length) return `显示提示 ${r + 1}`
    return '显示答案'
  }

  return (
    <div className="space-y-4">
      {questions.map((q, i) => {
        const r = revealed[i] ?? 0
        const answerShown = r > q.hints.length
        return (
          <div key={i} className="rounded-xl border border-surface-border bg-bg-surface p-4">
            <p className="mb-3 text-sm font-medium leading-relaxed text-text-primary">
              {i + 1}. {q.question}
            </p>
            <div className="space-y-2">
              {q.hints.slice(0, Math.min(r, q.hints.length)).map((hint, hi) => (
                <div key={hi} className="rounded-lg border border-amber-700/40 bg-amber-900/15 px-3 py-2">
                  <p className="mb-1 text-[10px] font-medium uppercase text-amber-400">提示 {hi + 1}</p>
                  <p className="text-sm leading-relaxed text-text-secondary">{hint}</p>
                </div>
              ))}
              {answerShown && (
                <div className="rounded-lg border border-green-800/40 bg-green-900/15 px-3 py-2">
                  <p className="mb-1 text-[10px] font-medium uppercase text-green-400">答案</p>
                  <p className="text-sm leading-relaxed text-text-secondary">{q.answer}</p>
                </div>
              )}
              {r === 0 && <p className="text-xs text-text-muted">先自己作答，再逐步显示提示和答案。</p>}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setRevealed((prev) => ({ ...prev, [i]: Math.min(q.hints.length + 1, (prev[i] ?? 0) + 1) }))}
                className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
              >
                {answerShown ? '已显示答案 ✓' : nextLabel(i)}
              </button>
              {r > 0 && (
                <button
                  onClick={() => setRevealed((prev) => ({ ...prev, [i]: 0 }))}
                  className="rounded border border-surface-border-strong px-3 py-1 text-xs text-text-muted hover:bg-bg-elevated"
                >
                  收起
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

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
  }, [scope?.conversationId])

  useEffect(() => {
    load()
  }, [load])

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
    { key: 'feynman', label: '费曼知识蛋', show: !!art('feynman_note') }
  ]
  const visibleTabs = TABS.filter((t) => t.show)
  const activeTab = visibleTabs.find((t) => t.key === tab) ?? visibleTabs[0]
  const currentKey = activeTab?.key ?? 'summary'

  const startDate = messages.length > 0 ? new Date(messages[0].createdAt).toLocaleString() : ''
  const endDate = messages.length > 0 ? new Date(messages[messages.length - 1].createdAt).toLocaleString() : ''

  const handleContinueLearning = async () => {
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
    useAppStore.getState().incrementResetKey()
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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{art('lesson_summary') ?? ''}</ReactMarkdown>
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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{art('diary') ?? ''}</ReactMarkdown>
          </div>
        ) : currentKey === 'progress' ? (
          <div className="markdown-body max-w-3xl">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{art('progress') ?? ''}</ReactMarkdown>
          </div>
        ) : (
          <div className="markdown-body max-w-3xl">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{art('feynman_note') ?? ''}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
