import { useState, useEffect, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { WORLD_ID } from '../types/models'
import {
  parseFlashcards,
  rebuildArtifactContent,
  buildAnkiImport
} from '../../../shared/flashcard-utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Flashcard {
  id: string
  artifactId: string
  cardIndex: number
  conversationId: string
  conversationTitle: string
  createdAt: string
  question: string
  answer: string
}

interface RawArtifact {
  id: string
  conversationId: string
  type: string
  content: string
  createdAt: string
}

interface ConversationDTO {
  id: string
  title: string
  companionId: string
  endedAt: string | null
}

/** SM-2 spaced-repetition state for a single card. */
interface SrsState {
  interval: number      // days until next review
  ease: number          // ease factor (starts at 2.5, min 1.3)
  reps: number          // consecutive successful reviews
  nextReview: number    // epoch ms timestamp
  lastReview: number    // epoch ms timestamp
}

type Rating = 'again' | 'hard' | 'good' | 'easy'

// ---------------------------------------------------------------------------
// SM-2 algorithm
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

function newSrsState(): SrsState {
  return { interval: 0, ease: 2.5, reps: 0, nextReview: 0, lastReview: 0 }
}

function qualityOf(rating: Rating): number {
  return { again: 0, hard: 3, good: 4, easy: 5 }[rating]
}

function updateSrs(state: SrsState, rating: Rating): SrsState {
  const q = qualityOf(rating)
  const now = Date.now()

  if (q < 3) {
    // Failed - reset
    return {
      interval: 1,          // review again tomorrow (well, next session)
      ease: Math.max(1.3, state.ease - 0.2),
      reps: 0,
      nextReview: now + DAY_MS,
      lastReview: now,
    }
  }

  const reps = state.reps + 1
  let interval: number
  if (reps === 1) {
    interval = rating === 'easy' ? 4 : 1
  } else if (reps === 2) {
    interval = rating === 'easy' ? 8 : 3
  } else {
    interval = Math.round(state.interval * state.ease)
  }

  const ease = Math.max(1.3, state.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))

  return {
    interval,
    ease,
    reps,
    nextReview: now + interval * DAY_MS,
    lastReview: now,
  }
}

function isDue(state: SrsState | undefined, now: number): boolean {
  if (!state || state.nextReview === 0) return true // new card
  return state.nextReview <= now
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const SRS_KEY = 'flashcard-srs-state'

function loadAllSrsLocal(): Record<string, SrsState> {
  try {
    const raw = localStorage.getItem(SRS_KEY)
    return raw ? JSON.parse(raw) as Record<string, SrsState> : {}
  } catch {
    return {}
  }
}

function saveAllSrsLocal(states: Record<string, SrsState>): void {
  try {
    localStorage.setItem(SRS_KEY, JSON.stringify(states))
  } catch {
    // quota / disabled - best-effort
  }
}

async function loadAllSrs(): Promise<Record<string, SrsState>> {
  try {
    const remote = await window.sophia.data.getFlashcardSrsState()
    const states = remote as Record<string, SrsState>
    // Merge into localStorage for instant access next time
    saveAllSrsLocal(states)
    return states
  } catch {
    return loadAllSrsLocal()
  }
}

function saveAllSrs(states: Record<string, SrsState>): void {
  saveAllSrsLocal(states)
  void window.sophia.data.saveFlashcardSrsState(states as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FlashcardReviewView(): React.ReactElement {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([])
  const [srsStates, setSrsStates] = useState<Record<string, SrsState>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sessionReviewed, setSessionReviewed] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editQuestion, setEditQuestion] = useState('')
  const [editAnswer, setEditAnswer] = useState('')
  const [editError, setEditError] = useState('')

  const loadFlashcards = useCallback(async () => {
    setLoading(true)
    try {
      const conversations = await window.sophia.data.listConversations(WORLD_ID) as ConversationDTO[]
      const endedConvs = conversations.filter((c) => c.endedAt)
      const allCards: Flashcard[] = []

      for (const conv of endedConvs) {
        try {
          const artifacts = await window.sophia.data.listArtifacts(conv.id) as RawArtifact[]
          const flashcardArtifacts = artifacts.filter((a) => a.type === 'flashcards')
          for (const art of flashcardArtifacts) {
            const parsed = parseFlashcards(art.content)
            for (let i = 0; i < parsed.length; i++) {
              allCards.push({
                id: `${art.id}_${i}`,
                artifactId: art.id,
                cardIndex: i,
                conversationId: conv.id,
                conversationTitle: conv.title,
                createdAt: art.createdAt,
                question: parsed[i].question,
                answer: parsed[i].answer
              })
            }
          }
        } catch {
          // skip
        }
      }

      // Sort: due cards first (by nextReview ascending), then new cards,
      // then future-scheduled cards (shouldn't appear in a review session
      // but are kept so the user can browse them).
      const states = await loadAllSrs()
      setSrsStates(states)
      const now = Date.now()
      allCards.sort((a, b) => {
        const sa = states[a.id]
        const sb = states[b.id]
        const aDue = isDue(sa, now)
        const bDue = isDue(sb, now)
        if (aDue && !bDue) return -1
        if (!aDue && bDue) return 1
        return (sa?.nextReview ?? 0) - (sb?.nextReview ?? 0)
      })

      setFlashcards(allCards)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFlashcards()
  }, [loadFlashcards])

  // Auto-advance to the next due card on load
  const dueCount = useMemo(() => {
    const now = Date.now()
    return flashcards.filter((c) => isDue(srsStates[c.id], now)).length
  }, [flashcards, srsStates])

  const handleRate = (rating: Rating) => {
    const card = flashcards[currentIndex]
    if (!card) return

    const prev = srsStates[card.id] ?? newSrsState()
    const updated = updateSrs(prev, rating)
    const newStates = { ...srsStates, [card.id]: updated }
    setSrsStates(newStates)
    saveAllSrs(newStates)
    setSessionReviewed((n) => n + 1)

    // Move to next card
    if (currentIndex < flashcards.length - 1) {
      setCurrentIndex(currentIndex + 1)
      setIsFlipped(false)
    }
  }

  const handleNext = () => {
    if (currentIndex < flashcards.length - 1) {
      setCurrentIndex(currentIndex + 1)
      setIsFlipped(false)
    }
  }

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
      setIsFlipped(false)
    }
  }

  const handleShuffle = () => {
    const shuffled = [...flashcards].sort(() => Math.random() - 0.5)
    setFlashcards(shuffled)
    setCurrentIndex(0)
    setIsFlipped(false)
  }

  const handleStartEdit = () => {
    const card = flashcards[currentIndex]
    if (!card) return
    setEditQuestion(card.question)
    setEditAnswer(card.answer)
    setEditError('')
    setEditing(true)
  }

  const handleSaveEdit = async () => {
    if (!editQuestion.trim()) {
      setEditError('问题不能为空')
      return
    }
    const card = flashcards[currentIndex]
    if (!card) return
    try {
      const artifact = await window.sophia.data.getArtifact(card.artifactId, card.conversationId)
      if (!artifact) {
        setEditError('找不到原卡片数据')
        return
      }
      const cards = parseFlashcards(artifact.content)
      if (card.cardIndex >= cards.length) {
        setEditError('原卡片内容已变化，请刷新后重试')
        return
      }
      cards[card.cardIndex] = {
        question: editQuestion.trim(),
        answer: editAnswer.trim()
      }
      const newContent = rebuildArtifactContent(cards)
      await window.sophia.data.updateArtifact(card.artifactId, card.conversationId, newContent)
      setFlashcards((prev) =>
        prev.map((c) =>
          c.id === card.id
            ? { ...c, question: editQuestion.trim(), answer: editAnswer.trim() }
            : c
        )
      )
      setEditing(false)
      setEditError('')
    } catch {
      setEditError('保存失败，请重试')
    }
  }

  const handleExportAnki = async () => {
    if (flashcards.length === 0) return
    const content = buildAnkiImport(
      flashcards.map((c) => ({
        question: c.question,
        answer: c.answer,
        conversationTitle: c.conversationTitle,
        createdAt: c.createdAt
      }))
    )
    const result = await window.sophia.dialog.saveFile({
      defaultPath: `Sophia_闪卡_${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: 'Anki 导入文本', extensions: ['txt'] }]
    })
    if (result.canceled || !result.filePath) return
    await window.sophia.data.writeTextFile(result.filePath, content)
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-text-muted">加载记忆卡片...</p>
      </div>
    )
  }

  if (flashcards.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-text-muted">
          <p className="text-lg">暂无记忆卡片</p>
          <p className="mt-2 text-sm">完成一堂课后，系统会自动生成记忆卡片供你复习</p>
        </div>
      </div>
    )
  }

  const card = flashcards[currentIndex]
  const cardSrs = srsStates[card.id]
  const isNew = !cardSrs || cardSrs.nextReview === 0
  const progress = ((currentIndex + 1) / flashcards.length) * 100
  const nextReviewLabel = cardSrs && !isNew
    ? cardSrs.interval === 1
      ? '明天'
      : `${cardSrs.interval} 天后`
    : '新卡片'

  return (
    <div className="flex h-full flex-col p-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">记忆卡片复习</h2>
        <div className="flex items-center gap-4">
          <span className="text-sm text-text-muted">
            待复习 {dueCount} · 本次已复习 {sessionReviewed}
          </span>
          <button
            onClick={handleExportAnki}
            disabled={flashcards.length === 0}
            className="rounded border border-surface-border-strong px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-elevated disabled:opacity-50"
            title="导出全部卡片为 Anki 可导入的文本文件"
          >
            导出 Anki
          </button>
          <button
            onClick={handleShuffle}
            className="rounded border border-surface-border-strong px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-elevated"
          >
            打乱顺序
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-bg-elevated">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Card */}
      <div className="flex flex-1 items-center justify-center">
        {editing ? (
          <div className="w-full max-w-2xl rounded-2xl border-2 border-accent-border bg-bg-surface p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="rounded-full bg-bg-elevated px-3 py-1 text-xs text-text-muted">
                修正卡片
              </span>
              {editError && <span className="text-xs text-red-400">{editError}</span>}
            </div>
            <label className="mb-1 block text-xs font-medium text-text-muted">问题</label>
            <textarea
              value={editQuestion}
              onChange={(e) => setEditQuestion(e.target.value)}
              rows={4}
              className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none resize-none"
            />
            <label className="mb-1 mt-4 block text-xs font-medium text-text-muted">答案</label>
            <textarea
              value={editAnswer}
              onChange={(e) => setEditAnswer(e.target.value)}
              rows={7}
              className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none resize-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setEditing(false); setEditError('') }}
                className="rounded border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                保存修正
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => setIsFlipped(!isFlipped)}
            className="relative w-full max-w-2xl cursor-pointer"
            style={{ minHeight: '300px' }}
          >
            <div
              className={`absolute inset-0 rounded-2xl border-2 p-8 transition-all duration-300 ${
                isFlipped
                  ? 'border-accent-border bg-bg-surface'
                  : 'border-surface-border-strong bg-bg-surface'
              }`}
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="rounded-full bg-bg-elevated px-3 py-1 text-xs text-text-muted">
                  {isFlipped ? '答案' : '问题'} · 点击翻转
                </span>
                <span className="text-xs text-text-muted">
                  {isNew ? '新' : `下次：${nextReviewLabel}`} · {currentIndex + 1}/{flashcards.length}
                </span>
              </div>
              <div className="markdown-body text-text-primary">
                {isFlipped ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.answer}</ReactMarkdown>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.question}</ReactMarkdown>
                )}
              </div>
              <p className="mt-6 text-xs text-text-muted">
                来源：{card.conversationTitle}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="rounded border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated disabled:opacity-30"
        >
          上一张
        </button>
        {isFlipped ? (
          <>
            <button
              onClick={handleStartEdit}
              className="rounded border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated"
              title="改正答案或解释"
            >
              修正
            </button>
            <button
              onClick={() => handleRate('again')}
              className="rounded bg-red-800 px-5 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              再看
            </button>
            <button
              onClick={() => handleRate('hard')}
              className="rounded bg-amber-700 px-5 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              困难
            </button>
            <button
              onClick={() => handleRate('good')}
              className="rounded bg-green-700 px-5 py-2 text-sm font-medium text-white hover:bg-green-600"
            >
              良好
            </button>
            <button
              onClick={() => handleRate('easy')}
              className="rounded bg-blue-700 px-5 py-2 text-sm font-medium text-white hover:bg-blue-600"
            >
              简单
            </button>
          </>
        ) : (
          <span className="px-4 py-2 text-sm text-text-muted">翻转卡片后评分</span>
        )}
        <button
          onClick={handleNext}
          disabled={currentIndex === flashcards.length - 1}
          className="rounded border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated disabled:opacity-30"
        >
          跳过
        </button>
      </div>
    </div>
  )
}
