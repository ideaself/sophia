import { useEffect, useRef, useState } from 'react'
import { buildDictUrl, loadDictConfig } from '../../../shared/dict'

interface DictionaryPopupProps {
  word: string
  /** Anchor position for the popup (center of the selection). */
  anchor: { x: number; y: number }
  onClose: () => void
}

type LoadState = 'loading' | 'ready' | 'error'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 1.5
const ZOOM_STEP = 0.1
/** 默认缩放 — 词典桌面页在小浮层里太大，先整体缩小。 */
const DEFAULT_ZOOM = 0.85

/**
 * 在线词典浮层 — 用 Electron <webview> 加载词典站点。
 *
 * 之所以不用 iframe：多数词典站（如有道）通过 X-Frame-Options / CSP
 * frame-ancestors 禁止被嵌入，iframe 会显示空白且 Chromium 不触发任何
 * 事件。webview 是独立的 guest 页面，不受该限制。
 * 安全（node 关闭、sandbox、仅 https）由主进程 will-attach-webview 强制。
 *
 * 页面适配：浮层可拖动调整大小（右下角），词典页可用 − / + 缩放。
 */
export function DictionaryPopup({ word, anchor, onClose }: DictionaryPopupProps): React.ReactElement {
  const [url, setUrl] = useState(() => buildDictUrl(loadDictConfig().template, word))
  const [status, setStatus] = useState<LoadState>('loading')
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const rootRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<HTMLElement | null>(null)
  const userAdjustedZoom = useRef(false)

  // Rebuild the URL if the word changes (e.g. a new selection while open).
  useEffect(() => {
    setUrl(buildDictUrl(loadDictConfig().template, word))
    setStatus('loading')
    userAdjustedZoom.current = false
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

  const applyZoom = (z: number) => {
    const wv = webviewRef.current as (HTMLElement & { getWebContents?: () => { setZoomFactor: (z: number) => void } }) | null
    const wc = wv?.getWebContents?.()
    if (!wc) return
    try {
      wc.setZoomFactor(z)
    } catch {
      // webview not ready yet — zoom applies on next dom-ready
    }
  }

  // Track the webview's load state; apply the default zoom on first load.
  useEffect(() => {
    const wv = webviewRef.current as (HTMLElement & {
      addEventListener: (t: string, fn: () => void) => void
      removeEventListener: (t: string, fn: () => void) => void
    }) | null
    if (!wv) return
    const onReady = () => {
      setStatus('ready')
      if (!userAdjustedZoom.current) applyZoom(DEFAULT_ZOOM)
    }
    const onFail = () => setStatus('error')
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('did-fail-load', onFail)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const changeZoom = (delta: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((zoom + delta) * 10) / 10))
    setZoom(next)
    userAdjustedZoom.current = true
    applyZoom(next)
  }

  const openInBrowser = () => {
    void window.sophia.app.openExternal(url)
    onClose()
  }

  const POPUP_W = 640
  const POPUP_H = 480

  return (
    <div
      ref={rootRef}
      className="fixed z-40 flex flex-col overflow-hidden rounded-xl border border-surface-border-strong bg-bg-surface shadow-2xl"
      style={{
        width: POPUP_W,
        height: POPUP_H,
        minWidth: 420,
        minHeight: 320,
        resize: 'both',
        overflow: 'hidden',
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
          {/* Zoom controls */}
          <div className="mr-1 flex items-center gap-0.5 rounded border border-surface-border-strong px-1 py-0.5 text-xs text-text-secondary" title="词典页面缩放">
            <button
              onClick={() => changeZoom(-ZOOM_STEP)}
              className="rounded px-1 hover:bg-bg-elevated"
              title="缩小"
            >
              −
            </button>
            <span className="w-9 text-center tabular-nums text-text-muted">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => changeZoom(ZOOM_STEP)}
              className="rounded px-1 hover:bg-bg-elevated"
              title="放大"
            >
              +
            </button>
          </div>
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
      <div className="relative flex-1">
        {status !== 'ready' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-bg-surface">
            {status === 'loading' ? (
              <p className="text-sm text-text-muted">词典加载中...</p>
            ) : (
              <>
                <p className="text-sm text-text-secondary">词典页面加载失败。</p>
                <button
                  onClick={openInBrowser}
                  className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
                >
                  在新窗口打开词典
                </button>
              </>
            )}
          </div>
        )}
        <webview
          ref={webviewRef}
          src={url}
          webpreferences="contextIsolation=yes, sandbox=yes, nodeIntegration=no"
          className="h-full w-full"
          style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }}
        />
      </div>
    </div>
  )
}
