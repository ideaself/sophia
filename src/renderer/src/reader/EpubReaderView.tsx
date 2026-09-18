import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { useTTS, stopTTS } from '../hooks/useTTS'
import { TTSControlPanel } from '../components/TTSControlPanel'
import { DictionaryPopup } from '../components/DictionaryPopup'
import { applyNotesToHtml } from '../../../shared/reading-notes-utils'
import { applySearchMarksToHtml } from './epub-search-marks'
import { isEnglishWord, loadDictConfig } from '../../../shared/dict'
import { useReadingNotes } from './useReadingNotes'
import { loadSyncedProgress, readLocalProgress, syncReadingProgress, writeLocalProgress } from './reading-progress'
import { ReaderSearchPopover } from './ReaderSearchPopover'

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
  /** 嵌入模式：不占满全屏，用于课堂分栏等内嵌场景。 */
  embedded?: boolean
}

interface SavedProgress {
  chapterIndex: number
  fontSize: number
  scrollY: number
}

function loadProgress(textbookId: string): SavedProgress | null {
  try {
    const raw = readLocalProgress('epub', textbookId)
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

function htmlToPlainText(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return (div.textContent ?? div.innerText ?? '').replace(/\s+/g, ' ').trim()
}

export function EpubReaderView({ textbookId, title, onClose, embedded }: EpubReaderViewProps): React.ReactElement {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [chapters, setChapters] = useState<EpubChapterData[]>([])
  const [chapterIndex, setChapterIndex] = useState(0)
  const [error, setError] = useState('')
  const saved = useMemo(() => loadProgress(textbookId), [textbookId])
  const [fontSize, setFontSize] = useState(saved?.fontSize ?? 16)
  const [tocOpen, setTocOpen] = useState(false)
  const [ttsOpen, setTtsOpen] = useState(false)
  const tts = useTTS('zh-CN')
  const tocRef = useRef<HTMLDivElement>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [selMenu, setSelMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteDraftOpen, setNoteDraftOpen] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  // 在线词典浮层（选中英文单词自动弹出，或选区菜单手动查词）
  const [dictPopup, setDictPopup] = useState<{ word: string } | null>(null)
  // ---- In-book search (Ctrl+F) ----
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const [searchCount, setSearchCount] = useState(0)
  const [chapterSearchCounts, setChapterSearchCounts] = useState<number[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchMarksRef = useRef<HTMLElement[]>([])

  // Chapter plain-text cache (id-keyed): converting HTML → text is the
  // expensive part of search; without the cache every chapter flip re-parsed
  // the whole book for the match counts.
  const chapterTextCacheRef = useRef<Map<string, string>>(new Map())
  const chapterIndexRef = useRef(chapterIndex)
  useEffect(() => { chapterIndexRef.current = chapterIndex }, [chapterIndex])
  // Switching textbooks invalidates the cache (chapter ids may repeat).
  useEffect(() => { chapterTextCacheRef.current = new Map() }, [textbookId])

  const chapterPlainText = useCallback((ch: EpubChapterData): string => {
    const cache = chapterTextCacheRef.current
    let text = cache.get(ch.id)
    if (text === undefined) {
      text = htmlToPlainText(ch.html).toLowerCase()
      cache.set(ch.id, text)
    }
    return text
  }, [])

  // Declared before the search effect that uses it (stable identity).
  const goToChapter = useCallback((idx: number) => {
    setChapterIndex(idx)
    setTocOpen(false)
  }, [])

  // ---- Load chapters ----
  useEffect(() => {
    let cancelled = false
    ;void (async () => {
      try {
        const result = await window.sophia.data.readEpubChapters(textbookId)
        /* v8 ignore next -- @preserve */
        if (cancelled) return
        if (!result || result.chapters.length === 0) {
          setError('该教材没有可读的章节（EPUB 的 spine 与 manifest 均未提供可读 HTML/XHTML；查看主进程日志以定位具体原因）')
          return
        }
        setChapters(result.chapters)
        // Try loading synced progress from the store (falls back to localStorage)
        const synced = await loadSyncedProgress(textbookId)
        if (synced?.lastPosition) {
          try {
            const parsed = JSON.parse(synced.lastPosition) as Partial<SavedProgress>
            if (typeof parsed.chapterIndex === 'number' && parsed.chapterIndex >= 0 && parsed.chapterIndex < result.chapters.length) {
              setChapterIndex(parsed.chapterIndex)
            }
            if (typeof parsed.fontSize === 'number') {
              setFontSize(parsed.fontSize)
            }
          } catch {
            // lastPosition might contain non-JSON (e.g. LLM progress content) - ignore
          }
        } else if (saved && saved.chapterIndex >= 0 && saved.chapterIndex < result.chapters.length) {
          setChapterIndex(saved.chapterIndex)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [textbookId, saved])

  // ---- Restore scroll position after chapter loads / changes ----
  useEffect(() => {
    if (chapters.length === 0) return
    const target = saved?.chapterIndex === chapterIndex ? saved?.scrollY ?? 0 : 0
    const el = scrollContainerRef.current
    if (el && target > 0) {
      const timer = setTimeout(() => { el.scrollTop = target }, 80)
      return () => clearTimeout(timer)
    }
  }, [chapters, chapterIndex, saved])

  // ---- Persist progress (debounced via rAF) ----
  useEffect(() => {
    if (chapters.length === 0) return
    const id = requestAnimationFrame(() => {
      const progress = {
        chapterIndex,
        fontSize,
        scrollY: scrollContainerRef.current?.scrollTop ?? 0
      }
      writeLocalProgress('epub', textbookId, JSON.stringify(progress))
      // Also persist to textbook store for WebDAV sync
      syncReadingProgress(textbookId, {
        currentPage: chapterIndex + 1,
        totalPages: chapters.length,
        readingPercentage: chapters.length > 0 ? (chapterIndex + 1) / chapters.length : 0,
        lastPosition: JSON.stringify(progress)
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

  // ---- Stop TTS on chapter change ----
  useEffect(() => {
    tts.stop()
    setTtsOpen(false)
    setSelMenu(null)
    setNoteDraftOpen(false)
    setDictPopup(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tts 对象每次渲染重建，仅需在章节变化时停止朗读
  }, [chapterIndex])

  // ---- Stop TTS when leaving the reader ----
  useEffect(() => stopTTS, [])

  // ---- Reading notes (shared hook: load / create / edit / delete) ----
  const { notes, createNote: createReadingNote, updateNoteText, removeNote } = useReadingNotes(textbookId)

  // ---- In-book search: Ctrl+F opens, Escape closes, ←→ switches chapters ----
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
      const target = e.target as HTMLElement | null
      const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (!isTyping && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setChapterIndex((i) => Math.max(0, i - 1))
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          setChapterIndex((i) => Math.min(chapters.length - 1, i + 1))
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen, chapters.length])

  // ---- In-book search: count matches per chapter ----
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) {
      setChapterSearchCounts([])
      setSearchCount(0)
      setSearchIndex(0)
      return
    }
    const timer = setTimeout(() => {
      const counts = chapters.map((ch) => {
        const text = chapterPlainText(ch)
        let n = 0
        let i = 0
        while ((i = text.indexOf(q, i)) !== -1) { n++; i += q.length }
        return n
      })
      setChapterSearchCounts(counts)
      setSearchCount(counts.reduce((a, b) => a + b, 0))
      // Jump to the first hit only when the query changes (not when the user
      // navigates to a chapter without matches — that used to bounce back).
      const currentIdx = chapterIndexRef.current
      if (counts[currentIdx] === 0) {
        const first = counts.findIndex((c) => c > 0)
        if (first >= 0) goToChapter(first)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [searchQuery, chapters, chapterPlainText, goToChapter])

  const current = chapters[chapterIndex]
  const rendered = useMemo(() => {
    if (!current) return { html: '', searchMatches: 0 }
    const safe = DOMPurify.sanitize(current.html, SANITIZE_CONFIG)
    const withNotes = applyNotesToHtml(safe, notes, chapterIndex)
    const marked = applySearchMarksToHtml(withNotes, searchQuery)
    return { html: marked.html, searchMatches: marked.count }
  }, [current, notes, chapterIndex, searchQuery])

  // Collect the search marks written by the controlled render above: they are
  // re-created whenever the markup changes, so the navigation ref must be
  // refreshed (and the index reset) on every render of the chapter HTML.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const marks = Array.from(content.querySelectorAll<HTMLElement>('mark[data-search="1"]'))
    searchMarksRef.current = marks
    setSearchIndex(0)
    marks[0]?.scrollIntoView({ block: 'center' })
  }, [rendered.html])

  const jumpSearchMatch = (dir: 1 | -1) => {
    const marks = searchMarksRef.current
    /* v8 ignore next -- @preserve */
    if (marks.length === 0) return
    const next = (searchIndex + dir + marks.length) % marks.length
    setSearchIndex(next)
    marks[next].scrollIntoView({ block: 'center' })
  }

  // ---- Selection toolbar (highlight / underline / note) ----
  const handleContentMouseUp = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelMenu(null)
      setNoteDraftOpen(false)
      return
    }
    const text = sel.toString().trim()
    const range = sel.getRangeAt(0)
    const container = contentRef.current
    if (
      !container ||
      !container.contains(range.commonAncestorContainer) ||
      text.length === 0 ||
      text.length > 1000
    ) {
      setSelMenu(null)
      setNoteDraftOpen(false)
      return
    }
    const rect = range.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    // 选中单个英文单词：启用词典时自动弹出查词，否则照常显示选区菜单。
    if (isEnglishWord(text) && loadDictConfig().enabled) {
      setSelMenu(null)
      setNoteDraftOpen(false)
      setDictPopup({ word: text })
      return
    }
    setDictPopup(null)
    setSelMenu({ x, y: rect.top, text })
  }

  const createNote = async (type: 'highlight' | 'underline' | 'note', readerNote = '') => {
    /* v8 ignore next -- @preserve */
    if (!selMenu) return
    const ok = await createReadingNote({
      content: selMenu.text,
      position: String(chapterIndex),
      chapter: current?.title ?? `第 ${chapterIndex + 1} 章`,
      type,
      readerNote
    })
    // Keep the selection on failure so the user can retry.
    if (!ok) return
    window.getSelection()?.removeAllRanges()
    setSelMenu(null)
    setNoteDraftOpen(false)
    setNoteDraft('')
  }

  const jumpToNote = (note: ReadingNoteDTO) => {
    const idx = parseInt(note.position, 10)
    if (!Number.isNaN(idx) && idx >= 0 && idx < chapters.length && idx !== chapterIndex) {
      goToChapter(idx)
    }
    setTimeout(() => {
      document.querySelector(`[data-note="${note.id}"]`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    }, 250)
  }

  const startEditNote = (note: ReadingNoteDTO) => {
    setEditingNoteId(note.id)
    setEditingNoteText(note.readerNote)
  }

  const saveEditNote = async (note: ReadingNoteDTO) => {
    await updateNoteText(note.id, editingNoteText.trim())
    setEditingNoteId(null)
  }

  const deleteNote = async (note: ReadingNoteDTO) => {
    await removeNote(note.id)
  }

  return (
    <div
      className={`${embedded ? 'relative flex h-full w-full flex-col' : 'fixed inset-0 z-50 flex flex-col'} bg-bg-deep`}
    >
      {/* ---- Toolbar ---- */}
      <div className="relative flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="truncate text-sm font-medium text-text-primary">{title}</h3>
          {chapters.length > 0 && (
            <span className="shrink-0 text-xs text-text-muted">
              {current?.title || `第 ${chapterIndex + 1} 章`} - {chapterIndex + 1}/{chapters.length}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* In-book search */}
          {chapters.length > 0 && (
            <div className="relative">
              <button
                onClick={() => { setSearchOpen((v) => !v); setTimeout(() => searchInputRef.current?.focus(), 0) }}
                className={`rounded border px-2 py-1 text-xs ${
                  searchOpen
                    ? 'border-accent text-accent'
                    : 'border-surface-border-strong hover:bg-bg-elevated'
                }`}
                title="在教材中搜索 (Ctrl+F)"
              >
                🔍 搜索
              </button>
              {searchOpen && (
                <ReaderSearchPopover
                  inputRef={searchInputRef}
                  query={searchQuery}
                  onQueryChange={(v) => { setSearchQuery(v); setSearchIndex(0) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      if (e.shiftKey) jumpSearchMatch(-1)
                      else jumpSearchMatch(1)
                    }
                  }}
                  placeholder="输入关键词，回车跳转..."
                  controls={
                    <>
                      <button
                        onClick={() => jumpSearchMatch(-1)}
                        className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
                        title="上一个 (Shift+Enter)"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => jumpSearchMatch(1)}
                        className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
                        title="下一个 (Enter)"
                      >
                        ▼
                      </button>
                    </>
                  }
                >
                  {searchQuery.trim() && (
                    <div className="mt-2">
                      <p className="text-[10px] text-text-muted">
                        本页 {searchIndex + 1}/{rendered.searchMatches} · 全书共 {searchCount} 处
                      </p>
                      {chapterSearchCounts.some((c) => c > 0) && (
                        <ul className="mt-1 max-h-40 overflow-auto space-y-0.5">
                          {chapterSearchCounts.map((c, i) =>
                            c > 0 ? (
                              <li key={i}>
                                <button
                                  onClick={() => goToChapter(i)}
                                  className={`block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-bg-elevated ${
                                    i === chapterIndex ? 'text-accent' : 'text-text-secondary'
                                  }`}
                                >
                                  {chapters[i]?.title || `第 ${i + 1} 章`} · {c} 处
                                </button>
                              </li>
                            ) : null
                          )}
                        </ul>
                      )}
                    </div>
                  )}
                </ReaderSearchPopover>
              )}
            </div>
          )}
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
          {chapters.length > 0 && tts.supported && (
            <div className="relative">
              <button
                onClick={() => {
                  if (tts.speaking) {
                    tts.stop()
                    setTtsOpen(false)
                    return
                  }
                  const text = htmlToPlainText(rendered.html)
                  /* v8 ignore next -- @preserve */
                  if (!text) return
                  tts.speak(text)
                  setTtsOpen(true)
                }}
                className={`rounded border px-2 py-1 text-xs ${
                  tts.speaking
                    ? 'border-accent text-accent'
                    : 'border-surface-border-strong hover:bg-bg-elevated'
                }`}
              >
                {tts.speaking ? '停止朗读' : '朗读'}
              </button>
              {ttsOpen && (
                <div className="absolute right-0 top-full z-20 mt-1">
                  <TTSControlPanel tts={tts} />
                </div>
              )}
            </div>
          )}
          {/* Reading notes */}
          {chapters.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setNotesOpen((v) => !v)}
                className={`rounded border px-2 py-1 text-xs ${
                  notesOpen
                    ? 'border-accent text-accent'
                    : 'border-surface-border-strong hover:bg-bg-elevated'
                }`}
              >
                📌 笔记{notes.length > 0 && ` (${notes.length})`}
              </button>
              {notesOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 max-h-[70vh] w-96 overflow-auto rounded border border-surface-border bg-bg-surface p-3 shadow-lg">
                  {notes.length === 0 ? (
                    <p className="text-xs text-text-muted">
                      暂无笔记。选中文字即可高亮、下划线或添加笔记。
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {notes.map((note) => (
                        <div
                          key={note.id}
                          className="rounded border border-surface-border-strong/60 bg-bg-elevated/40 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-text-muted">
                              {note.type === 'underline'
                                ? '〰️ 下划线'
                                : note.type === 'note'
                                  ? '📝 笔记'
                                  : '🖍️ 高亮'} · {note.chapter}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => startEditNote(note)}
                                className="text-xs text-text-muted hover:text-text-secondary"
                                title="编辑笔记"
                                aria-label="编辑笔记"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => deleteNote(note)}
                                className="text-xs text-text-muted hover:text-red-400"
                                title="删除笔记"
                                aria-label="删除笔记"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                          <button
                            onClick={() => jumpToNote(note)}
                            className="mt-1 block max-w-full truncate text-left text-xs text-text-secondary hover:text-accent-hover"
                            title="跳转到文中位置"
                          >
                            {note.content}
                          </button>
                          {editingNoteId === note.id ? (
                            <div className="mt-2 space-y-1">
                              <textarea
                                rows={2}
                                value={editingNoteText}
                                onChange={(e) => setEditingNoteText(e.target.value)}
                                className="w-full resize-none rounded border border-surface-border-strong bg-bg-deep px-2 py-1 text-xs text-text-primary focus:outline-none"
                              />
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => setEditingNoteId(null)}
                                  className="text-xs text-text-muted hover:text-text-secondary"
                                >
                                  取消
                                </button>
                                <button
                                  onClick={() => saveEditNote(note)}
                                  className="rounded bg-accent px-2 py-0.5 text-xs text-white hover:bg-accent-hover"
                                >
                                  保存
                                </button>
                              </div>
                            </div>
                          ) : note.readerNote ? (
                            <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">
                              {note.readerNote}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
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
            ref={contentRef}
            onMouseUp={handleContentMouseUp}
            className="epub-content mx-auto max-w-4xl leading-relaxed text-text-secondary [&_img]:my-4 [&_img]:mx-auto [&_img]:max-w-full [&_img]:h-auto [&_svg]:my-4 [&_svg]:mx-auto [&_svg]:max-w-full [&_svg]:h-auto [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-lg [&_h3]:font-medium [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:my-3 [&_a]:text-accent-hover [&_a]:underline"
            style={{ fontSize: `${fontSize}px` }}
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        )}
      </div>
      {/* Selection toolbar */}
      {selMenu && (
        <div
          className="fixed z-30 flex items-center gap-1 rounded-lg border border-surface-border bg-bg-surface px-2 py-1 shadow-lg"
          style={{ left: selMenu.x, top: selMenu.y - 8, transform: 'translate(-50%, -100%)' }}
        >
          <button
            onClick={() => createNote('highlight')}
            className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-elevated"
            title="高亮选中文字"
            aria-label="高亮选中文字"
          >
            🖍️ 高亮
          </button>
          <button
            onClick={() => createNote('underline')}
            className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-elevated"
            title="下划线"
            aria-label="下划线"
          >
            〰️ 下划线
          </button>
          <button
            onClick={() => setNoteDraftOpen(true)}
            className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-elevated"
            title="添加笔记"
            aria-label="添加笔记"
          >
            📝 笔记
          </button>
          {isEnglishWord(selMenu.text) && (
            <button
              onClick={() => {
                setDictPopup({ word: selMenu.text })
                setSelMenu(null)
              }}
              className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-elevated"
              title="在线词典查词"
              aria-label="在线词典查词"
            >
              📖 查词
            </button>
          )}
        </div>
      )}
      {noteDraftOpen && selMenu && (
        <div
          className="fixed z-30 w-72 rounded-lg border border-surface-border bg-bg-surface p-3 shadow-lg"
          style={{ left: selMenu.x, top: selMenu.y - 12, transform: 'translate(-50%, -100%)' }}
        >
          <textarea
            rows={3}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            autoFocus
            placeholder="写下你的想法..."
            className="w-full resize-none rounded border border-surface-border-strong bg-bg-deep px-2 py-1.5 text-xs text-text-primary placeholder-gray-500 focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => { setNoteDraftOpen(false); setNoteDraft('') }}
              className="text-xs text-text-muted hover:text-text-secondary"
            >
              取消
            </button>
            <button
              onClick={() => createNote('note', noteDraft.trim())}
              className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover"
            >
              保存笔记
            </button>
          </div>
        </div>
      )}

      {/* Bottom-right chapter pager */}
      {chapters.length > 0 && (
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-lg border border-surface-border bg-bg-surface px-3 py-2 shadow-xl">
          <button
            onClick={() => setChapterIndex((i) => Math.max(0, i - 1))}
            disabled={chapterIndex <= 0}
            className="rounded border border-surface-border-strong px-2.5 py-1 text-xs hover:bg-bg-elevated disabled:opacity-40"
            title="上一章 (←)"
          >
            ◀ 上一章
          </button>
          <span className="max-w-44 truncate text-xs text-text-secondary" title={current?.title ?? ''}>
            第 {chapterIndex + 1} / {chapters.length} 章 · {current?.title || `第 ${chapterIndex + 1} 章`}
          </span>
          <button
            onClick={() => setChapterIndex((i) => Math.min(chapters.length - 1, i + 1))}
            disabled={chapterIndex >= chapters.length - 1}
            className="rounded border border-surface-border-strong px-2.5 py-1 text-xs hover:bg-bg-elevated disabled:opacity-40"
            title="下一章 (→)"
          >
            下一章 ▶
          </button>
        </div>
      )}

      {/* 在线词典浮层 */}
      {dictPopup && (
        <DictionaryPopup
          word={dictPopup.word}
          onClose={() => setDictPopup(null)}
        />
      )}
    </div>
  )
}
