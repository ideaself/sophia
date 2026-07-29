import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { WORLD_ID } from '../types/models'

interface Flashcard {
  id: string
  conversationId: string
  conversationTitle: string
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

function parseFlashcards(content: string): Array<{ question: string; answer: string }> {
  const cards: Array<{ question: string; answer: string }> = []
  const lines = content.split('\n')
  let currentQ = ''
  let currentA = ''
  let inQ = false
  let inA = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.match(/^[-*]\s*问题[：:]\s*(.+)/)) {
      if (currentQ && currentA) {
        cards.push({ question: currentQ, answer: currentA })
      }
      currentQ = trimmed.replace(/^[-*]\s*问题[：:]\s*/, '')
      currentA = ''
      inQ = true
      inA = false
    } else if (trimmed.match(/^[-*]\s*答案[：:]\s*(.+)/)) {
      currentA = trimmed.replace(/^[-*]\s*答案[：:]\s*/, '')
      inQ = false
      inA = true
    } else if (inQ && trimmed) {
      currentQ += '\n' + trimmed
    } else if (inA && trimmed) {
      currentA += '\n' + trimmed
    }
  }
  if (currentQ && currentA) {
    cards.push({ question: currentQ, answer: currentA })
  }
  return cards
}

export function FlashcardReviewView(): React.ReactElement {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set())

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
                conversationId: conv.id,
                conversationTitle: conv.title,
                question: parsed[i].question,
                answer: parsed[i].answer
              })
            }
          }
        } catch {
          // skip
        }
      }

      allCards.sort((a, b) => b.conversationId.localeCompare(a.conversationId))
      setFlashcards(allCards)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFlashcards()
  }, [loadFlashcards])

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

  const handleMarkReviewed = () => {
    if (flashcards[currentIndex]) {
      setReviewedIds(new Set([...reviewedIds, flashcards[currentIndex].id]))
    }
    handleNext()
  }

  const handleShuffle = () => {
    const shuffled = [...flashcards].sort(() => Math.random() - 0.5)
    setFlashcards(shuffled)
    setCurrentIndex(0)
    setIsFlipped(false)
    setReviewedIds(new Set())
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
  const progress = ((currentIndex + 1) / flashcards.length) * 100
  const reviewedCount = reviewedIds.size

  return (
    <div className="flex h-full flex-col p-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">记忆卡片复习</h2>
        <div className="flex items-center gap-4">
          <span className="text-sm text-text-muted">
            已复习 {reviewedCount} / {flashcards.length}
          </span>
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
                卡片 {currentIndex + 1} / {flashcards.length}
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
      </div>

      {/* Controls */}
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="rounded border border-surface-border-strong px-6 py-2 text-sm text-text-secondary hover:bg-bg-elevated disabled:opacity-30"
        >
          上一张
        </button>
        <button
          onClick={handleMarkReviewed}
          className="rounded bg-green-700 px-6 py-2 text-sm font-medium text-white hover:bg-green-600"
        >
          已记住
        </button>
        <button
          onClick={handleNext}
          disabled={currentIndex === flashcards.length - 1}
          className="rounded border border-surface-border-strong px-6 py-2 text-sm text-text-secondary hover:bg-bg-elevated disabled:opacity-30"
        >
          下一张
        </button>
      </div>
    </div>
  )
}
