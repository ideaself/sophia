import { useEffect, useRef, useState } from 'react'
import { buildDictUrl, loadDictConfig } from '../../../shared/dict'

interface DictionaryPopupProps {
  word: string
  /** Anchor position for the popup (center of the selection). */
  anchor: { x: number; y: number }
  onClose: () => void
}

/**
 * 在线词典浮层 — 内嵌词典站点 iframe 查询选中单词，
 * 附带「在新窗口打开」（部分站点禁止 iframe 嵌入时兜底）。
 */
export function DictionaryPopup({ word, anchor, onClose }: DictionaryPopupProps): React.ReactElement {
  const [url, setUrl] = useState(() => buildDictUrl(loadDictConfig().template, word))
  const [loadFailed, setLoadFailed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Rebuild the URL if the word changes (e.g. a new selection while open).
  useEffect(() => {
    setUrl(buildDictUrl(loadDictConfig().template, word))
    setLoadFailed(false)
  }, [word])

  // Close on outside click / Escape.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Some sites (X-Frame-Options) refuse embedding and fire an error on the
  // iframe — surface a fallback message with an open-in-browser button.
  useEffect(() => {
    const el = iframeRef.current
    if (!el) return
    const onError = () => setLoadFailed(true)
    el.addEventListener('error', onError)
    return () => el.removeEventListener('error', onError)
  }, [url])

  const openInBrowser = () => {
    void window.sophia.app.openExternal(url)
    onClose()
  }

  const POPUP_W = 520
  const POPUP_H = 380

  return (
    <div
      ref={rootRef}
      className="fixed z-40 flex flex-col overflow-hidden rounded-xl border border-surface-border-strong bg-bg-surface shadow-2xl"
      style={{
        width: POPUP_W,
        height: POPUP_H,
        left: Math.max(8, Math.min(anchor.x - POPUP_W / 2, window.innerWidth - POPUP_W - 8)),
        top: Math.max(8, Math.min(anchor.y + 16, window.innerHeight - POPUP_H - 8))
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-surface-border bg-bg-elevated px-3 py-1.5">
        <p className="min-w-0 truncate text-sm font-medium text-text-primary">
          📖 {word}
        </p>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            onClick={openInBrowser}
            className="rounded border border-surface-border-strong px-2 py-0.5 text-xs text-text-secondary hover:bg-bg-elevated"
            title="在系统浏览器中打开词典"
          >
            在新窗口打开
          </button>
          <button
            onClick={onClose}
            className="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
            title="关闭 (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="relative flex-1 bg-white">
        {loadFailed ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg-surface p-6 text-center">
            <p className="text-sm text-text-secondary">该词典站点不允许在应用内嵌入显示。</p>
            <button
              onClick={openInBrowser}
              className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              在新窗口打开词典
            </button>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            key={url}
            src={url}
            title={`在线词典：${word}`}
            className="h-full w-full border-0"
          />
        )}
      </div>
    </div>
  )
}
