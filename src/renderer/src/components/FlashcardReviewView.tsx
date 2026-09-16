import { useState, useEffect, useCallback, useMemo, lazy, Suspense, useRef } from 'react'
import {
  parseFlashcards,
  rebuildArtifactContent,
  buildAnkiImport
} from '../../../shared/flashcard-utils'
import {
  type Flashcard,
  type SrsState,
  type Rating,
  newSrsState,
  updateSrs,
  isDue,
  loadAllSrs,
  saveAllSrs,
  loadAllFlashcards,
  loadAllFavorites,
  toggleFavorite
} from '../hooks/useFlashcards'

const MarkdownRenderer = lazy(() => import('../lib/MarkdownRenderer'))

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FlashcardScope {
  conversationId: string
  title: string
}

interface FlashcardReviewViewProps {
  /** When set, review only this lesson's new cards (4.0.1). */
  scope?: FlashcardScope | null
  /** Clear the scope and return to the full deck. */
  onClearScope?: () => void
}

/** Minimum cards shown in a scoped (post-class) review before old cards are pulled in. */
const MIN_SCOPED_CARDS = 5

type DeckTab = 'all' | 'favorites'
type ExportScope = 'current' | 'all' | 'favorites'

export function FlashcardReviewView({ scope, onClearScope }: FlashcardReviewViewProps): React.ReactElement {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([])
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [srsStates, setSrsStates] = useState<Record<string, SrsState>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sessionReviewed, setSessionReviewed] = useState(0)
  const [sessionCorrect, setSessionCorrect] = useState(0)
  // 键盘连答：handleRate 每次渲染重建，用 ref 保证按键处理器拿到最新闭包
  const handleRateRef = useRef<(rating: Rating) => void>(() => {})
  const [editing, setEditing] = useState(false)
  const [editQuestion, setEditQuestion] = useState('')
  const [editAnswer, setEditAnswer] = useState('')
  const [editError, setEditError] = useState('')
  const [tab, setTab] = useState<DeckTab>('all')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const loadFlashcards = useCallback(async () => {
    setLoading(true)
    try {
      const [allCards, states, favs] = await Promise.all([loadAllFlashcards(), loadAllSrs(), loadAllFavorites()])
      setSrsStates(states)
      setFavorites(favs)
      const now = Date.now()

      // Scoped (post-class) review: this lesson's new cards first; when few,
      // supplement with due cards from other lessons (4.0.1).
      let cards = allCards
      if (scope?.conversationId) {
        const lessonCards = allCards.filter((c) => c.conversationId === scope.conversationId)
        if (lessonCards.length < MIN_SCOPED_CARDS) {
          const supplement = allCards
            .filter((c) => c.conversationId !== scope.conversationId && isDue(states[c.id], now))
            .sort((a, b) => (states[a.id]?.nextReview ?? 0) - (states[b.id]?.nextReview ?? 0))
          cards = [...lessonCards, ...supplement]
        } else {
          cards = lessonCards
        }
      }

      // Sort: due cards first (by nextReview ascending), then new cards,
      // then future-scheduled cards (shouldn't appear in a review session
      // but are kept so the user can browse them).
      cards.sort((a, b) => {
        const sa = states[a.id]
        const sb = states[b.id]
        const aDue = isDue(sa, now)
        const bDue = isDue(sb, now)
        if (aDue && !bDue) return -1
        if (!aDue && bDue) return 1
        return (sa?.nextReview ?? 0) - (sb?.nextReview ?? 0)
      })

      setFlashcards(cards)
    } finally {
      setLoading(false)
    }
  }, [scope?.conversationId])

  useEffect(() => {
    void loadFlashcards()
  }, [loadFlashcards])

  // The deck shown under the active tab.
  const displayList = useMemo(() => {
    if (tab === 'favorites') return flashcards.filter((c) => favorites.has(c.id))
    return flashcards
  }, [flashcards, favorites, tab])

  // Keep the index valid when the deck shrinks (tab switch / filter change).
  useEffect(() => {
    if (currentIndex >= displayList.length) {
      setCurrentIndex(Math.max(0, displayList.length - 1))
    }
  }, [displayList.length, currentIndex])

  const dueCount = useMemo(() => {
    const now = Date.now()
    return flashcards.filter((c) => isDue(srsStates[c.id], now)).length
  }, [flashcards, srsStates])

  const currentCard = displayList[currentIndex]
  const cardSrs = currentCard ? srsStates[currentCard.id] : undefined
  const isNew = !cardSrs || cardSrs.nextReview === 0
  const isFav = currentCard ? favorites.has(currentCard.id) : false

  const handleRate = (rating: Rating) => {
    const card = currentCard
    if (!card) return

    const prev = srsStates[card.id] ?? newSrsState()
    const updated = updateSrs(prev, rating)
    const newStates = { ...srsStates, [card.id]: updated }
    setSrsStates(newStates)
    saveAllSrs(newStates)
    setSessionReviewed((n) => n + 1)
    if (rating !== 'again') setSessionCorrect((n) => n + 1)

    // Move to next card
    if (currentIndex < displayList.length - 1) {
      setCurrentIndex(currentIndex + 1)
      setIsFlipped(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- 每次渲染同步最新 handleRate 到 ref（键盘连答需要最新闭包）
  useEffect(() => {
    handleRateRef.current = handleRate
  }, [handleRate])

  // 键盘连答：空格翻面，数字 1-4 评分（1=再看 2=困难 3=良好 4=简单）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (isTyping) return
      if (e.key === ' ') {
        e.preventDefault()
        setIsFlipped((v) => !v)
        return
      }
      if (!isFlipped) return
      const map: Record<string, Rating> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' }
      const rating = map[e.key]
      if (rating) {
        e.preventDefault()
        handleRateRef.current(rating)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isFlipped])

  const handleNext = () => {
    if (currentIndex < displayList.length - 1) {
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
    const shuffled = [...displayList].sort(() => Math.random() - 0.5)
    if (tab === 'favorites') {
      setFlashcards((prev) => shuffled.concat(prev.filter((c) => !favorites.has(c.id))))
    } else {
      setFlashcards(shuffled)
    }
    setCurrentIndex(0)
    setIsFlipped(false)
  }

  const handleToggleFavorite = () => {
    if (!currentCard) return
    setFavorites((prev) => toggleFavorite(prev, currentCard.id))
  }

  const handleStartEdit = () => {
    if (!currentCard) return
    setEditQuestion(currentCard.question)
    setEditAnswer(currentCard.answer)
    setEditError('')
    setEditing(true)
  }

  const handleSaveEdit = async () => {
    if (!editQuestion.trim()) {
      setEditError('问题不能为空')
      return
    }
    const card = currentCard
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

  // ------------------------------------------------------------------
  // Export (2.0.0 / 4.5.0) — scope selectable per need
  // ------------------------------------------------------------------

  const runExport = async (target: Flashcard[]) => {
    if (target.length === 0) return
    const content = buildAnkiImport(
      target.map((c) => ({
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
    setExportMenuOpen(false)
  }

  const exportScopeOptions: Array<{ key: ExportScope; label: string; cards: Flashcard[] }> = [
    { key: 'current', label: `导出当前列表（${displayList.length} 张）`, cards: displayList },
    { key: 'all', label: `导出全部卡片（${flashcards.length} 张）`, cards: flashcards },
    { key: 'favorites', label: `仅导出珍藏（${flashcards.filter((c) => favorites.has(c.id)).length} 张）`, cards: flashcards.filter((c) => favorites.has(c.id)) }
  ]

  const handleExport = () => {
    if (displayList.length === 0) return
    setExportMenuOpen((v) => !v)
  }

  // ------------------------------------------------------------------
  // Batch operations (2.0.0)
  // ------------------------------------------------------------------

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllInList = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of displayList) next.add(c.id)
      return next
    })
  }

  const clearSelection = () => setSelected(new Set())

  const handleBatchExport = async () => {
    const target = displayList.filter((c) => selected.has(c.id))
    await runExport(target)
  }

  const handleBatchDelete = async () => {
    if (selected.size === 0 || busy) return
    const target = displayList.filter((c) => selected.has(c.id))
    const confirmed = await window.sophia.dialog.confirm({
      message: `确定删除选中的 ${target.length} 张卡片吗？此操作不可撤销，复习进度一并失效。`
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await window.sophia.data.deleteFlashcardCards(
        target.map((c) => ({ conversationId: c.conversationId, artifactId: c.artifactId, cardIndex: c.cardIndex }))
      )
      setSelected(new Set())
      await loadFlashcards()
    } catch {
      // best-effort: keep selection on failure
    } finally {
      setBusy(false)
    }
  }

  const progress = displayList.length > 0 ? ((currentIndex + 1) / displayList.length) * 100 : 0
  const nextReviewLabel = cardSrs && !isNew
    ? cardSrs.interval === 1
      ? '明天'
      : `${cardSrs.interval} 天后`
    : '新卡片'

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

  if (displayList.length === 0 && tab === 'favorites') {
    return (
      <div className="flex h-full flex-col p-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-1">
            <button
              onClick={() => setTab('all')}
              className="rounded px-3 py-1.5 text-sm font-medium text-text-muted hover:bg-bg-elevated"
            >
              全部（{flashcards.length}）
            </button>
            <button
              onClick={() => setTab('favorites')}
              className="rounded px-3 py-1.5 text-sm font-medium bg-accent text-white"
            >
              珍藏（{flashcards.filter((c) => favorites.has(c.id)).length}）
            </button>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-text-muted">
            <p className="text-lg">还没有珍藏卡片</p>
            <p className="mt-2 text-sm">在卡片右上角点击 ☆ 即可收藏</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-8">
      {scope && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-accent-border bg-accent-subtle px-4 py-2">
          <p className="text-sm text-text-secondary">
            正在复习 <span className="font-medium text-text-primary">{scope.title}</span> 的本课新卡（不足 {MIN_SCOPED_CARDS} 张时自动补充以前到期的卡片）
          </p>
          <button
            onClick={onClearScope}
            className="flex-shrink-0 rounded border border-surface-border-strong px-3 py-1 text-xs text-text-secondary hover:bg-bg-elevated"
          >
            返回全部卡片
          </button>
        </div>
      )}

      {/* Deck tabs + actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('all')}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === 'all' ? 'bg-accent text-white' : 'text-text-muted hover:bg-bg-elevated'
            }`}
          >
            全部（{flashcards.length}）
          </button>
          <button
            onClick={() => setTab('favorites')}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === 'favorites' ? 'bg-accent text-white' : 'text-text-muted hover:bg-bg-elevated'
            }`}
          >
            珍藏（{flashcards.filter((c) => favorites.has(c.id)).length}）
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">
            待复习 {dueCount} · 本次已复习 {sessionReviewed} · 答对 {sessionCorrect}
          </span>
          <div className="relative">
            <button
              onClick={handleExport}
              disabled={displayList.length === 0}
              className="rounded border border-surface-border-strong px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-elevated disabled:opacity-50"
            >
              导出 Anki
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-surface-border-strong bg-bg-surface py-1 shadow-xl">
                {exportScopeOptions.filter((o) => o.cards.length > 0).map((o) => (
                  <button
                    key={o.key}
                    onClick={() => void runExport(o.cards)}
                    className="block w-full px-4 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => { setSelectMode((v) => !v); setSelected(new Set()) }}
            className={`rounded border px-3 py-1.5 text-sm transition-colors ${
              selectMode
                ? 'border-accent bg-accent text-white'
                : 'border-surface-border-strong text-text-secondary hover:bg-bg-elevated'
            }`}
          >
            {selectMode ? '完成选择' : '批量操作'}
          </button>
          <button
            onClick={handleShuffle}
            className="rounded border border-surface-border-strong px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-elevated"
          >
            打乱顺序
          </button>
        </div>
      </div>

      {/* Batch selection toolbar */}
      {selectMode && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-border bg-bg-surface px-4 py-2">
          <p className="text-sm text-text-secondary">
            已选 <span className="font-medium text-text-primary">{selected.size}</span> 张
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={selectAllInList}
              className="rounded border border-surface-border-strong px-3 py-1 text-xs text-text-secondary hover:bg-bg-elevated"
            >
              全选当前列表
            </button>
            <button
              onClick={clearSelection}
              className="rounded border border-surface-border-strong px-3 py-1 text-xs text-text-secondary hover:bg-bg-elevated"
            >
              清空
            </button>
            <button
              onClick={() => void handleBatchExport()}
              disabled={selected.size === 0 || busy}
              className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              批量导出 Anki
            </button>
            <button
              onClick={() => void handleBatchDelete()}
              disabled={selected.size === 0 || busy}
              className="rounded bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
            >
              批量删除
            </button>
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-bg-elevated">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Batch-select list view */}
      {selectMode ? (
        <div className="flex-1 overflow-auto">
          <ul className="space-y-2">
            {displayList.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-surface-border bg-bg-surface px-4 py-3 hover:border-accent-border">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggleSelect(c.id)}
                    className="mt-1 h-4 w-4 flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="markdown-body line-clamp-2 text-sm text-text-primary">
                      <Suspense fallback={null}>
                        <MarkdownRenderer>{c.question}</MarkdownRenderer>
                      </Suspense>
                    </div>
                    <p className="mt-1 text-xs text-text-muted truncate">
                      来源：{c.conversationTitle} · {c.createdAt.slice(0, 10)}
                    </p>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
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
                    <span className="flex items-center gap-3 text-xs text-text-muted">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleFavorite() }}
                        className={`text-base leading-none ${isFav ? 'text-amber-700' : 'text-text-muted hover:text-amber-600'}`}
                        title={isFav ? '取消珍藏' : '加入珍藏'}
                      >
                        {isFav ? '★' : '☆'}
                      </button>
                      <span>{isNew ? '新' : `下次：${nextReviewLabel}`} · {currentIndex + 1}/{displayList.length}</span>
                    </span>
                  </div>
                  <div className="markdown-body text-text-primary">
                    <Suspense fallback={null}>
                      {isFlipped ? (
                        <MarkdownRenderer>{currentCard.answer}</MarkdownRenderer>
                      ) : (
                        <MarkdownRenderer>{currentCard.question}</MarkdownRenderer>
                      )}
                    </Suspense>
                  </div>
                  <p className="mt-6 text-xs text-text-muted">
                    来源：{currentCard.conversationTitle}
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
                  className="rounded bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover"
                >
                  简单
                </button>
              </>
            ) : (
              <span className="px-4 py-2 text-sm text-text-muted">翻转卡片后评分</span>
            )}
            <button
              onClick={handleNext}
              disabled={currentIndex === displayList.length - 1}
              className="rounded border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated disabled:opacity-30"
            >
              跳过
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] text-text-muted">
            键盘连答：空格翻面 · 1 再看 / 2 困难 / 3 良好 / 4 简单
          </p>
        </>
      )}
    </div>
  )
}
