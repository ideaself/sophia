import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface PdfReaderViewProps {
  textbookId: string
  title: string
  onClose: () => void
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

const PROGRESS_KEY = (id: string) => `pdf-progress-${id}`

export function PdfReaderView({ textbookId, title, onClose }: PdfReaderViewProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.5)
  const [error, setError] = useState('')
  const [highlights, setHighlights] = useState<HighlightRect[]>([])
  // In-page search (Ctrl+F)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pageTextCache = useRef<Record<number, string>>({})
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

  // Restore last page from textbook store / localStorage
  useEffect(() => {
    let cancelled = false
    ;(async () => {
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
    ;(async () => {
      try {
        const result = await window.sophia.data.readTextbookOriginal(textbookId)
        if (cancelled) return
        if (!result) {
          setError('该教材没有原件')
          return
        }
        const loaded = await pdfjs.getDocument({ data: result.data }).promise
        if (cancelled) return
        setDoc(loaded)
        setPageCount(loaded.numPages)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [textbookId])

  // Render current page
  useEffect(() => {
    if (!doc || !canvasRef.current) return
    let cancelled = false
    ;(async () => {
      const page = await doc.getPage(pageNum)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current!
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvas, viewport }).promise
      if (cancelled) return
      // Recompute highlights for this page after render
      const q = searchQuery.trim().toLowerCase()
      if (q) {
        const rects = await computeHighlights(page, viewport, q)
        if (!cancelled) setHighlights(rects)
      } else {
        setHighlights([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, pageNum, scale]) // eslint-disable-line react-hooks/exhaustive-deps

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
      if (hits.length > 0) setPageNum(hits[0].page)
    } finally {
      setSearching(false)
    }
  }

  const computeHighlights = async (
    page: pdfjs.PDFPageProxy,
    viewport: pdfjs.PageViewport,
    q: string
  ): Promise<HighlightRect[]> => {
    const content = await page.getTextContent()
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
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-deep">
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-2">
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
      <div ref={containerRef} className="flex-1 overflow-auto p-4">
        {error ? (
          <p className="mt-8 text-sm text-red-400">{error}</p>
        ) : (
          <div className="relative inline-block">
            <canvas ref={canvasRef} className="shadow-lg" />
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
          </div>
        )}
      </div>

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
