import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'

interface EpubChapterData {
  id: string
  title: string
  html: string
}

const SANITIZE_CONFIG = {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'link', 'base', 'style'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'srcset', 'action', 'formaction'],
  ALLOW_DATA_ATTR: false
}

interface EpubReaderViewProps {
  textbookId: string
  title: string
  onClose: () => void
}

const PROGRESS_KEY = (id: string) => `epub-progress-${id}`

interface SavedProgress {
  chapterIndex: number
  fontSize: number
  scrollY: number
}

function loadProgress(textbookId: string): SavedProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY(textbookId))
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<SavedProgress>
    return {
      chapterIndex: typeof data.chapterIndex === 'number' ? data.chapterIndex : 0,
      fontSize: typeof data.fontSize === 'number' ? data.fontSize : 16,
      scrollY: typeof data.scrollY === 'number' ? data.scrollY : 0
    }
  } catch {
    return null
  }
}

function saveProgress(textbookId: string, progress: SavedProgress): void {
  try {
    localStorage.setItem(PROGRESS_KEY(textbookId), JSON.stringify(progress))
  } catch {
    // quota / disabled storage - best-effort
  }
}

function htmlToPlainText(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return (div.textContent ?? div.innerText ?? '').replace(/\s+/g, ' ').trim()
}

export function EpubReaderView({ textbookId, title, onClose }: EpubReaderViewProps): React.ReactElement {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [chapters, setChapters] = useState<EpubChapterData[]>([])
  const [chapterIndex, setChapterIndex] = useState(0)
  const [error, setError] = useState('')
  const saved = useMemo(() => loadProgress(textbookId), [textbookId])
  const [fontSize, setFontSize] = useState(saved?.fontSize ?? 16)
  const [tocOpen, setTocOpen] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const tocRef = useRef<HTMLDivElement>(null)

  // ---- Load chapters ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await window.sophia.data.readEpubChapters(textbookId)
        if (cancelled) return
        if (!result || result.chapters.length === 0) {
          setError('该教材没有可读的章节（EPUB 的 spine 与 manifest 均未提供可读 HTML/XHTML；查看主进程日志以定位具体原因）')
          return
        }
        setChapters(result.chapters)
        if (saved && saved.chapterIndex >= 0 && saved.chapterIndex < result.chapters.length) {
          setChapterIndex(saved.chapterIndex)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [textbookId])

  // ---- Restore scroll position after chapter loads / changes ----
  useEffect(() => {
    if (chapters.length === 0) return
    const target = saved?.chapterIndex === chapterIndex ? saved?.scrollY ?? 0 : 0
    const el = scrollContainerRef.current
    if (el && target > 0) {
      const timer = setTimeout(() => { el.scrollTop = target }, 80)
      return () => clearTimeout(timer)
    }
  }, [chapters, chapterIndex])

  // ---- Persist progress (debounced via rAF) ----
  useEffect(() => {
    if (chapters.length === 0) return
    const id = requestAnimationFrame(() => {
      saveProgress(textbookId, {
        chapterIndex,
        fontSize,
        scrollY: scrollContainerRef.current?.scrollTop ?? 0
      })
    })
    return () => cancelAnimationFrame(id)
  }, [textbookId, chapterIndex, fontSize, chapters.length])

  // ---- Close TOC on outside click ----
  useEffect(() => {
    if (!tocOpen) return
    const handler = (e: MouseEvent) => {
      if (tocRef.current && !tocRef.current.contains(e.target as Node)) {
        setTocOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [tocOpen])

  // ---- Stop TTS on unmount / chapter change ----
  useEffect(() => {
    return () => {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    }
  }, [])
  useEffect(() => {
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel()
      setIsSpeaking(false)
    }
  }, [chapterIndex])

  const current = chapters[chapterIndex]
  const safeHtml = useMemo(
    () => (current ? DOMPurify.sanitize(current.html, SANITIZE_CONFIG) : ''),
    [current]
  )

  // ---- TTS ----
  const toggleSpeak = () => {
    if (typeof speechSynthesis === 'undefined') return
    if (isSpeaking) {
      speechSynthesis.cancel()
      setIsSpeaking(false)
      return
    }
    const text = htmlToPlainText(safeHtml)
    if (!text) return
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'zh-CN'
    utter.rate = 1.0
    utter.onend = () => setIsSpeaking(false)
    utter.onerror = () => setIsSpeaking(false)
    speechSynthesis.speak(utter)
    setIsSpeaking(true)
  }

  const goToChapter = (idx: number) => {
    setChapterIndex(idx)
    setTocOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-deep">
      {/* ---- Toolbar ---- */}
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="truncate text-sm font-medium text-text-primary">{title}</h3>
          {chapters.length > 0 && (
            <span className="shrink-0 text-xs text-text-muted">
              {current?.title || `第 ${chapterIndex + 1} 章`} - {chapterIndex + 1}/{chapters.length}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* TOC dropdown */}
          {chapters.length > 0 && (
            <div ref={tocRef} className="relative">
              <button
                onClick={() => setTocOpen((v) => !v)}
                className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
              >
                目录
              </button>
              {tocOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 max-h-[60vh] w-72 overflow-auto rounded border border-surface-border bg-bg-surface shadow-lg">
                  {chapters.map((ch, i) => (
                    <button
                      key={ch.id}
                      onClick={() => goToChapter(i)}
                      className={`block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-bg-elevated ${
                        i === chapterIndex ? 'text-accent' : 'text-text-secondary'
                      }`}
                    >
                      {i + 1}. {ch.title || `第 ${i + 1} 章`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* TTS */}
          {chapters.length > 0 && typeof speechSynthesis !== 'undefined' && (
            <button
              onClick={toggleSpeak}
              className={`rounded border px-2 py-1 text-xs ${
                isSpeaking
                  ? 'border-accent text-accent'
                  : 'border-surface-border-strong hover:bg-bg-elevated'
              }`}
            >
              {isSpeaking ? '停止朗读' : '朗读'}
            </button>
          )}
          {/* Font size */}
          <button
            onClick={() => setFontSize((s) => Math.max(10, s - 2))}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
          >
            A−
          </button>
          <button
            onClick={() => setFontSize((s) => Math.min(36, s + 2))}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
          >
            A+
          </button>
          {/* Chapter nav */}
          <button
            onClick={() => setChapterIndex((i) => Math.max(0, i - 1))}
            disabled={chapterIndex <= 0}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated disabled:opacity-50"
          >
            上一章
          </button>
          <button
            onClick={() => setChapterIndex((i) => Math.min(chapters.length - 1, i + 1))}
            disabled={chapterIndex >= chapters.length - 1}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated disabled:opacity-50"
          >
            下一章
          </button>
          <button
            onClick={onClose}
            className="rounded border border-surface-border-strong px-3 py-1 text-xs text-red-400 hover:bg-red-900/30"
          >
            关闭
          </button>
        </div>
      </div>
      {/* ---- Content ---- */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto px-8 py-6">
        {error ? (
          <p className="mt-8 text-sm text-red-400">{error}</p>
        ) : chapters.length === 0 ? (
          <p className="mt-8 text-sm text-text-muted">加载中...</p>
        ) : (
          <div
            className="epub-content mx-auto max-w-4xl leading-relaxed text-text-secondary [&_img]:my-4 [&_img]:mx-auto [&_img]:max-w-full [&_img]:h-auto [&_svg]:my-4 [&_svg]:mx-auto [&_svg]:max-w-full [&_svg]:h-auto [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-lg [&_h3]:font-medium [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:my-3 [&_a]:text-blue-400 [&_a]:underline"
            style={{ fontSize: `${fontSize}px` }}
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        )}
      </div>
    </div>
  )
}
