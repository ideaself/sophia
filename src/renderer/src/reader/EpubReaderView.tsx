import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'

interface EpubChapterData {
  id: string
  title: string
  html: string
}

// EPUB chapter HTML comes from arbitrary third-party files; even with a strict
// CSP, we still sanitize before injection to defend against DOM-clobbering,
// data-exfil via CSS, iframe/form injection, and future CSP relaxations.
//
// The URI regexp additionally allows `data:image/*` so that images we inline
// as base64 in the main process (see epub-parser.inlineImages) survive the
// sanitizer. Non-image data: URIs are still refused.
const SANITIZE_CONFIG = {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'link', 'base', 'style'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'srcset', 'action', 'formaction'],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpe?g|gif|webp|svg\+xml|bmp|x-icon);base64,|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
}

interface EpubReaderViewProps {
  textbookId: string
  title: string
  onClose: () => void
}

export function EpubReaderView({ textbookId, title, onClose }: EpubReaderViewProps): React.ReactElement {
  const contentRef = useRef<HTMLDivElement>(null)
  const [chapters, setChapters] = useState<EpubChapterData[]>([])
  const [chapterIndex, setChapterIndex] = useState(0)
  const [error, setError] = useState('')
  const [fontSize, setFontSize] = useState(16)

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
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [textbookId])

  const current = chapters[chapterIndex]
  const safeHtml = useMemo(
    () => (current ? DOMPurify.sanitize(current.html, SANITIZE_CONFIG) : ''),
    [current]
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-deep">
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-text-primary">{title}</h3>
          {chapters.length > 0 && (
            <span className="text-xs text-text-muted">
              {current?.title || `第 ${chapterIndex + 1} 章`} — {chapterIndex + 1}/{chapters.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
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
      <div ref={contentRef} className="flex-1 overflow-auto px-8 py-6">
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
