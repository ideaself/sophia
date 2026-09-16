import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { DictionaryPopup } from '../components/DictionaryPopup'
import { isEnglishWord, loadDictConfig } from '../../../shared/dict'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface PdfReaderViewProps {
  textbookId: string
  title: string
  onClose: () => void
  /** 嵌入模式：不占满全屏，用于课堂分栏等内嵌场景。 */
  embedded?: boolean
}

interface SearchHit {
  page: number
  count: number
}

interface HighlightRect {
  x: number
  y: number
  width: number
  height: number
}

/** 持久化批注在当前页渲染出的高亮矩形（与搜索高亮区分颜色）。 */
interface NoteHighlight {
  rect: HighlightRect
  className: string
}

type PdfTextContent = Awaited<ReturnType<pdfjs.PDFPageProxy['getTextContent']>>

const PROGRESS_KEY = (id: string) => `pdf-progress-${id}`

/** 批注在页面位图上的高亮样式（页面是白色位图，用半透明暖色）。 */
const NOTE_HIGHLIGHT_CLASS: Record<string, string> = {
  highlight: 'bg-yellow-300/50',
  underline: 'bg-blue-300/40 border-b-2 border-blue-500/60',
  note: 'bg-yellow-300/50',
  bookmark: 'bg-amber-300/40'
}

export function PdfReaderView({ textbookId, title, onClose, embedded }: PdfReaderViewProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const textLayerInstanceRef = useRef<pdfjs.TextLayer | null>(null)
  const textLayerPageRef = useRef<number | null>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.5)
  const [error, setError] = useState('')
  const [highlights, setHighlights] = useState<HighlightRect[]>([])
  // 持久化批注（与 EPUB 阅读器同一套 ReadingNote 数据）
  const [notes, setNotes] = useState<ReadingNoteDTO[]>([])
  const [notesOpen, setNotesOpen] = useState(false)
  const [noteHighlights, setNoteHighlights] = useState<NoteHighlight[]>([])
  // 选中文本后的小工具条（高亮 / 笔记）
  const [selMenu, setSelMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteDraftOpen, setNoteDraftOpen] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  // 在线词典浮层（选中英文单词自动弹出）
  const [dictPopup, setDictPopup] = useState<{ word: string } | null>(null)
  // In-page search (Ctrl+F)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pageTextCache = useRef<Record<number, string>>({})
  // The active loading task/document must be destroyed on unmount or book
  // switch — otherwise the pdfjs worker keeps the document alive forever.
  const loadingTaskRef = useRef<pdfjs.PDFDocumentLoadingTask | null>(null)
  // The in-flight canvas render task; cancelled when the page/scale changes
  // so a stale render cannot paint over the new one (or leak).
  const renderTaskRef = useRef<pdfjs.RenderTask | null>(null)
  // Search term that has actually been applied (Enter / 搜索按钮), not the
  // raw input value — typing must not re-render the page bitmap.
  const [appliedSearch, setAppliedSearch] = useState('')
  // Bottom-right pager: editable page number input
  const [pageInput, setPageInput] = useState('1')
  const pageInputRef = useRef<HTMLInputElement>(null)

  // Keep the page input in sync with pageNum (unless the user is typing in it)
  useEffect(() => {
    if (document.activeElement !== pageInputRef.current) {
      setPageInput(String(pageNum))
    }
  }, [pageNum])

  const goToPage = (n: number) => {
    if (!pageCount) return
    setPageNum(Math.min(pageCount, Math.max(1, n)))
  }

  const submitPageInput = () => {
    const n = parseInt(pageInput, 10)
    if (Number.isNaN(n)) {
      setPageInput(String(pageNum))
      return
    }
    goToPage(n)
  }

  // Load persisted reading notes for this textbook
  useEffect(() => {
    window.sophia.data.listReadingNotes(textbookId)
      .then(setNotes)
      .catch(() => setNotes([]))
  }, [textbookId])

  // Restore last page from textbook store / localStorage
  useEffect(() => {
    let cancelled = false
    ;void (async () => {
      try {
        const tb = await window.sophia.data.getTextbook(textbookId)
        if (cancelled || !tb) return
        const stored = tb.progress?.currentPage
        if (typeof stored === 'number' && stored > 0) setPageNum(stored)
      } catch {
        try {
          const raw = localStorage.getItem(PROGRESS_KEY(textbookId))
          const n = raw ? parseInt(raw, 10) : 0
          if (n > 0) setPageNum(n)
        } catch { /* ignore */ }
      }
    })()
    return () => { cancelled = true }
  }, [textbookId])

  // Load the document once
  useEffect(() => {
    let cancelled = false
    // Cache is per-document: never carry page text across books.
    pageTextCache.current = {}
    ;void (async () => {
      try {
        const result = await window.sophia.data.readTextbookOriginal(textbookId)
        if (cancelled) return
        if (!result) {
          setError('该教材没有原件')
          return
        }
        const task = pdfjs.getDocument({ data: result.data })
        loadingTaskRef.current = task
        const loaded = await task.promise
        if (cancelled) {
          void task.destroy().catch(() => {})
          return
        }
        setDoc(loaded)
        setPageCount(loaded.numPages)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      }
    })()
    return () => {
      cancelled = true
      // Drop the old document + text layer so nothing keeps rendering it.
      setDoc(null)
      textLayerInstanceRef.current?.cancel()
      textLayerInstanceRef.current = null
      textLayerPageRef.current = null
      const task = loadingTaskRef.current
      loadingTaskRef.current = null
      if (task) {
        void task.destroy().catch(() => {})
      }
    }
  }, [textbookId])

  // Render current page + selectable text layer
  useEffect(() => {
    if (!doc || !canvasRef.current) return
    let cancelled = false
    ;void (async () => {
      try {
        // A stale render must never finish on top of a newer one.
        renderTaskRef.current?.cancel()
        renderTaskRef.current = null

        const page = await doc.getPage(pageNum)
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current!
        // 与 TextLayer 保持同一坐标系：TextLayer 内部按 viewport.scale ×
        // devicePixelRatio 定位文本，canvas 必须做同样的 DPR 高清渲染，
        // 否则高 DPI 屏上文本层与位图错位（且页面会模糊）。
        const outputScale = new pdfjs.OutputScale()
        canvas.width = Math.floor(viewport.width * outputScale.sx)
        canvas.height = Math.floor(viewport.height * outputScale.sy)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        const renderTask = page.render({
          canvas,
          viewport,
          transform: outputScale.scaled ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0] : undefined
        })
        renderTaskRef.current = renderTask
        await renderTask.promise
        renderTaskRef.current = null
        if (cancelled) return

        // --- Text layer: transparent selectable text over the bitmap ---
        const textLayerDiv = textLayerRef.current
        if (textLayerDiv) {
          textLayerDiv.style.width = `${viewport.width}px`
          textLayerDiv.style.height = `${viewport.height}px`
          // span 字形大小 = --total-scale-factor × --font-height（PDF 单位），
          // 必须与位图保持同一缩放，否则缩放页面时文本层字号不变而错位。
          textLayerDiv.style.setProperty('--total-scale-factor', String(viewport.scale))
          const existing = textLayerInstanceRef.current
          try {
            if (existing && textLayerPageRef.current === pageNum) {
              // Same page: just re-layout for the new scale.
              existing.update({ viewport })
            } else {
              // New page: drop the previous layer and rebuild.
              existing?.cancel()
              textLayerInstanceRef.current = null
              textLayerDiv.innerHTML = ''
              const instance = new pdfjs.TextLayer({
                textContentSource: page.streamTextContent(),
                container: textLayerDiv,
                viewport
              })
              textLayerPageRef.current = pageNum
              textLayerInstanceRef.current = instance
              await instance.render()
              if (cancelled) {
                instance.cancel()
                textLayerInstanceRef.current = null
                textLayerDiv.innerHTML = ''
              }
            }
          } catch {
            // best-effort — selection falls back to none on this page
          }
        }

        // Text content feeds both search and note highlights — fetch it once
        // per render instead of once per annotation.
        const textContent = await page.getTextContent()
        if (cancelled) return

        // Recompute search highlights for this page after render
        if (appliedSearch) {
          setHighlights(computeHighlights(textContent, viewport, appliedSearch))
        } else {
          setHighlights([])
        }

        // 持久化批注高亮：在当前页文本中定位每条批注的矩形
        const pageNotes = notes.filter((n) => n.position === String(pageNum))
        const noteRects: NoteHighlight[] = []
        for (const n of pageNotes) {
          const rs = computeHighlights(textContent, viewport, n.content.trim().toLowerCase())
          if (rs.length > 0) {
            noteRects.push({
              rect: rs[0],
              className: NOTE_HIGHLIGHT_CLASS[n.type] ?? NOTE_HIGHLIGHT_CLASS.highlight
            })
          }
        }
        if (!cancelled) setNoteHighlights(noteRects)
      } catch (err) {
        // Cancellation (page/scale change or unmount) lands here by design;
        // anything else is logged without tearing the reader down.
        if (
          !cancelled &&
          !(err instanceof Error && err.name === 'RenderingCancelledException')
        ) {
          console.warn('[pdf] page render failed:', err)
        }
      }
    })()
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
    }
  }, [doc, pageNum, scale, notes, appliedSearch])

  // 选中英文单词 → 自动弹出在线词典；其他选区 → 显示批注工具条
  const handleContentMouseUp = (e: React.MouseEvent) => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const text = sel.toString().trim()
    if (!text || text.length > 500) return
    if (isEnglishWord(text) && loadDictConfig().enabled) {
      setDictPopup({ word: text })
      setSelMenu(null)
      return
    }
    setDictPopup(null)
    setSelMenu({ x: e.clientX, y: e.clientY, text })
  }

  // 选区工具条关闭（点击页面其他地方 / Esc）
  const clearSelMenu = () => {
    setSelMenu(null)
    setNoteDraftOpen(false)
  }

  const createNote = async (type: 'highlight' | 'note', readerNote = '') => {
    const text = (selMenu?.text ?? '').trim()
    if (!text) return
    try {
      await window.sophia.data.createReadingNote({
        textbookId,
        content: text,
        position: String(pageNum),
        chapter: `第 ${pageNum} 页`,
        type,
        readerNote
      })
      window.getSelection()?.removeAllRanges()
      clearSelMenu()
      setNoteDraft('')
      const updated = await window.sophia.data.listReadingNotes(textbookId)
      setNotes(updated)
    } catch {
      // 创建失败——保持选中，用户可重试
    }
  }

  const jumpToNote = (note: ReadingNoteDTO) => {
    const p = parseInt(note.position, 10)
    if (Number.isFinite(p) && p > 0) goToPage(p)
  }

  const startEditNote = (note: ReadingNoteDTO) => {
    setEditingNoteId(note.id)
    setEditingNoteText(note.readerNote)
  }

  const saveEditNote = async (note: ReadingNoteDTO) => {
    const text = editingNoteText
    setEditingNoteId(null)
    try {
      await window.sophia.data.updateReadingNote(note.id, textbookId, { readerNote: text })
      setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, readerNote: text } : n)))
    } catch {
      // best-effort
    }
  }

  const deleteNote = async (note: ReadingNoteDTO) => {
    try {
      await window.sophia.data.deleteReadingNote(note.id, textbookId)
      setNotes((prev) => prev.filter((n) => n.id !== note.id))
    } catch {
      // best-effort
    }
  }

  // Clean up the text layer on unmount
  useEffect(() => {
    return () => {
      textLayerInstanceRef.current?.cancel()
    }
  }, [])

  // Persist progress
  useEffect(() => {
    if (pageCount === 0) return
    try {
      localStorage.setItem(PROGRESS_KEY(textbookId), String(pageNum))
    } catch { /* best-effort */ }
    void window.sophia.data.updateTextbookProgress(textbookId, {
      currentPage: pageNum,
      totalPages: pageCount,
      readingPercentage: pageCount > 0 ? pageNum / pageCount : 0
    }).catch(() => {})
  }, [textbookId, pageNum, pageCount])

  // Ctrl+F open / Escape close / ←→ page navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault()
        setSearchOpen((v) => !v)
        setTimeout(() => searchInputRef.current?.focus(), 0)
        return
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        return
      }
      if (e.key === 'Escape') {
        setSelMenu(null)
        setNoteDraftOpen(false)
        return
      }
      // Arrow keys page through the document when not typing
      const target = e.target as HTMLElement | null
      const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (!isTyping && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault()
          setPageNum((p) => Math.max(1, p - 1))
        } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
          e.preventDefault()
          setPageNum((p) => Math.min(pageCount || 1, p + 1))
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen, pageCount])

  const fitWidth = async () => {
    if (!doc || !containerRef.current) return
    const page = await doc.getPage(pageNum)
    const base = page.getViewport({ scale: 1 })
    setScale((containerRef.current.clientWidth - 32) / base.width)
  }

  const runSearch = async () => {
    if (!doc) return
    const q = searchQuery.trim().toLowerCase()
    setSearching(true)
    try {
      if (!q) {
        setSearchHits([])
        setHighlights([])
        setAppliedSearch('')
        return
      }
      const hits: SearchHit[] = []
      for (let p = 1; p <= pageCount; p++) {
        let text = pageTextCache.current[p]
        if (text === undefined) {
          const page = await doc.getPage(p)
          const content = await page.getTextContent()
          text = content.items
            .map((it) => ('str' in it ? (it as { str: string }).str : ''))
            .join(' ')
            .toLowerCase()
          pageTextCache.current[p] = text
        }
        let n = 0
        let i = 0
        while ((i = text.indexOf(q, i)) !== -1) { n++; i += q.length }
        if (n > 0) hits.push({ page: p, count: n })
      }
      setSearchHits(hits)
      // Applying the term triggers the highlight pass even when the current
      // page already is the first hit (pageNum alone would not change).
      setAppliedSearch(q)
      if (hits.length > 0) setPageNum(hits[0].page)
    } finally {
      setSearching(false)
    }
  }

  const computeHighlights = (
    content: PdfTextContent,
    viewport: pdfjs.PageViewport,
    q: string
  ): HighlightRect[] => {
    const rects: HighlightRect[] = []
    for (const item of content.items) {
      if (!('str' in item)) continue
      const str = (item as { str: string; transform: number[]; width: number }).str
      const lower = str.toLowerCase()
      let idx = lower.indexOf(q)
      if (idx === -1) continue
      const transform = (item as { transform: number[] }).transform
      const width = (item as { width: number }).width
      const fontHeight = Math.abs(transform[3]) * viewport.scale
      // Baseline position in viewport CSS px
      const pos = pdfjs.Util.transform(viewport.transform, [transform[4], transform[5]])
      const charW = (width / Math.max(1, str.length)) * viewport.scale
      while (idx !== -1) {
        rects.push({
          x: pos[0] + idx * charW,
          y: pos[1] - fontHeight,
          width: q.length * charW,
          height: fontHeight
        })
        idx = lower.indexOf(q, idx + q.length)
      }
    }
    return rects
  }

  return (
    <div
      className={`${embedded ? 'relative flex h-full w-full flex-col' : 'fixed inset-0 z-50 flex flex-col'} bg-bg-deep`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-4 py-2">
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        <div className="flex items-center gap-2">
          {/* Search */}
          {pageCount > 0 && (
            <div className="relative">
              <button
                onClick={() => { setSearchOpen((v) => !v); setTimeout(() => searchInputRef.current?.focus(), 0) }}
                className={`rounded border px-2 py-1 text-xs ${
                  searchOpen ? 'border-accent text-accent' : 'border-surface-border-strong hover:bg-bg-elevated'
                }`}
                title="在 PDF 中搜索 (Ctrl+F)"
              >
                🔍 搜索
              </button>
              {searchOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded border border-surface-border bg-bg-surface p-3 shadow-lg">
                  <div className="flex items-center gap-2">
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault()
                          void runSearch()
                        }
                      }}
                      placeholder="输入关键词，回车搜索..."
                      className="w-full rounded border border-surface-border-strong bg-bg-deep px-2 py-1 text-xs text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
                    />
                    <button
                      onClick={() => void runSearch()}
                      disabled={searching}
                      className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      {searching ? '搜索中' : '搜索'}
                    </button>
                  </div>
                  {searchHits.length > 0 && (
                    <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto">
                      {searchHits.map((h) => (
                        <li key={h.page}>
                          <button
                            onClick={() => setPageNum(h.page)}
                            className={`block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-bg-elevated ${
                              h.page === pageNum ? 'text-accent' : 'text-text-secondary'
                            }`}
                          >
                            第 {h.page} 页 · {h.count} 处
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {searchHits.length === 0 && searchQuery.trim() && !searching && (
                    <p className="mt-2 text-[10px] text-text-muted">未找到匹配</p>
                  )}
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => setNotesOpen((v) => !v)}
            className={`rounded border px-2 py-1 text-xs ${
              notesOpen ? 'border-accent text-accent' : 'border-surface-border-strong hover:bg-bg-elevated'
            }`}
            title="阅读批注（选中文本后可用高亮 / 笔记）"
          >
            📌 笔记{notes.length > 0 && ` (${notes.length})`}
          </button>
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
          >
            −
          </button>
          <button
            onClick={() => setScale((s) => Math.min(4, s + 0.25))}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
          >
            +
          </button>
          <button
            onClick={fitWidth}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
          >
            适应宽度
          </button>
          <button
            onClick={onClose}
            className="rounded border border-surface-border-strong px-3 py-1 text-xs text-red-400 hover:bg-red-900/30"
          >
            关闭
          </button>
        </div>
      </div>
      <div ref={containerRef} onMouseUp={handleContentMouseUp} onMouseDown={clearSelMenu} className="flex-1 overflow-auto p-4">
        {error ? (
          <p className="mt-8 text-sm text-red-400">{error}</p>
        ) : (
          <div className="relative inline-block">
            <canvas ref={canvasRef} className="shadow-lg" />
            <div ref={textLayerRef} className="textLayer" />
            {highlights.map((r, i) => (
              <div
                key={i}
                className="pointer-events-none absolute bg-amber-400/40"
                style={{
                  left: r.x,
                  top: r.y,
                  width: r.width,
                  height: r.height
                }}
              />
            ))}
            {noteHighlights.map((nh, i) => (
              <div
                key={`note-${i}`}
                className={`pointer-events-none absolute ${nh.className}`}
                style={{
                  left: nh.rect.x,
                  top: nh.rect.y,
                  width: nh.rect.width,
                  height: nh.rect.height
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 在线词典浮层 */}
      {dictPopup && (
        <DictionaryPopup
          word={dictPopup.word}
          onClose={() => setDictPopup(null)}
        />
      )}

      {/* 选区批注工具条 */}
      {selMenu && !noteDraftOpen && (
        <div
          className="fixed z-50 flex items-center gap-1 rounded-lg border border-surface-border bg-bg-surface px-1.5 py-1 shadow-xl"
          style={{ left: selMenu.x, top: Math.max(4, selMenu.y - 38) }}
        >
          <button
            onClick={() => void createNote('highlight')}
            className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-elevated"
            title="高亮这段文字"
          >
            🖍️ 高亮
          </button>
          <button
            onClick={() => setNoteDraftOpen(true)}
            className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-elevated"
            title="为这段文字写一条笔记"
          >
            📝 笔记
          </button>
          <button
            onClick={clearSelMenu}
            className="rounded px-1.5 py-1 text-xs text-text-muted hover:bg-bg-elevated"
            title="取消 (Esc)"
          >
            ✕
          </button>
        </div>
      )}

      {/* 笔记草稿输入 */}
      {selMenu && noteDraftOpen && (
        <div
          className="fixed z-50 w-72 rounded-lg border border-surface-border bg-bg-surface p-3 shadow-xl"
          style={{ left: selMenu.x, top: Math.max(4, selMenu.y - 38) }}
        >
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={3}
            autoFocus
            placeholder={`笔记（第 ${pageNum} 页）：${selMenu.text.slice(0, 30)}${selMenu.text.length > 30 ? '…' : ''}`}
            className="w-full resize-none rounded border border-surface-border-strong bg-bg-deep px-2 py-1.5 text-xs text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => { setNoteDraftOpen(false); setNoteDraft('') }}
              className="rounded px-2 py-1 text-xs text-text-muted hover:bg-bg-elevated"
            >
              取消
            </button>
            <button
              onClick={() => void createNote('note', noteDraft.trim())}
              className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
            >
              保存笔记
            </button>
          </div>
        </div>
      )}

      {/* 批注面板 */}
      {notesOpen && (
        <div className="absolute bottom-0 right-0 top-0 z-30 flex w-72 flex-col border-l border-surface-border bg-bg-surface">
          <div className="flex items-center justify-between border-b border-surface-border px-3 py-2">
            <span className="text-sm font-semibold">阅读批注</span>
            <button
              onClick={() => setNotesOpen(false)}
              className="rounded p-1 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {notes.length === 0 ? (
              <p className="px-2 py-4 text-xs text-text-muted">
                还没有批注。选中 PDF 中的文字后，用「🖍️ 高亮」或「📝 笔记」添加。
              </p>
            ) : (
              <ul className="space-y-2">
                {notes.map((note) => (
                  <li key={note.id} className="rounded-lg border border-surface-border bg-bg-deep p-2.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] text-text-muted">
                        {note.type === 'underline'
                          ? '〰️ 下划线'
                          : note.type === 'note'
                            ? '📝 笔记'
                            : '🖍️ 高亮'} · {note.chapter}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => jumpToNote(note)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
                          title="跳到该页"
                        >
                          跳转
                        </button>
                        <button
                          onClick={() => startEditNote(note)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => void deleteNote(note)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-bg-elevated hover:text-red-400"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">{note.content}</p>
                    {editingNoteId === note.id ? (
                      <div className="mt-1.5">
                        <textarea
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value)}
                          rows={2}
                          autoFocus
                          className="w-full resize-none rounded border border-surface-border-strong bg-bg-surface px-2 py-1 text-xs text-text-primary focus:border-accent-border focus:outline-none"
                          placeholder="写点想法..."
                        />
                        <div className="mt-1 flex justify-end gap-2">
                          <button
                            onClick={() => setEditingNoteId(null)}
                            className="text-[10px] text-text-muted hover:text-text-secondary"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => void saveEditNote(note)}
                            className="rounded bg-accent px-2 py-0.5 text-[10px] text-white hover:bg-accent-hover"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : note.readerNote ? (
                      <p className="mt-1.5 border-l-2 border-accent-border pl-2 text-xs leading-relaxed text-text-muted">
                        {note.readerNote}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Bottom-right pager */}
      {pageCount > 0 && (
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-lg border border-surface-border bg-bg-surface px-3 py-2 shadow-xl">
          <button
            onClick={() => goToPage(pageNum - 1)}
            disabled={pageNum <= 1}
            className="rounded border border-surface-border-strong px-2.5 py-1 text-xs hover:bg-bg-elevated disabled:opacity-40"
            title="上一页 (←)"
          >
            ◀ 上一页
          </button>
          <div className="flex items-center gap-1 text-xs text-text-secondary">
            <input
              ref={pageInputRef}
              type="text"
              inputMode="numeric"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submitPageInput()
                  pageInputRef.current?.blur()
                }
              }}
              onBlur={submitPageInput}
              className="w-12 rounded border border-surface-border-strong bg-bg-deep px-1.5 py-1 text-center text-xs text-text-primary focus:border-accent-border focus:outline-none"
              title="输入页码后回车跳转"
            />
            <span>/ {pageCount}</span>
          </div>
          <button
            onClick={() => goToPage(pageNum + 1)}
            disabled={pageNum >= pageCount}
            className="rounded border border-surface-border-strong px-2.5 py-1 text-xs hover:bg-bg-elevated disabled:opacity-40"
            title="下一页 (→)"
          >
            下一页 ▶
          </button>
        </div>
      )}
    </div>
  )
}
