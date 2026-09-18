import { useEffect, useRef, useState } from 'react'
import {
  buildDictUrl,
  loadDictConfig,
  loadDictPopupPrefs,
  saveDictPopupPrefs
} from '../../../shared/dict'

interface DictionaryPopupProps {
  word: string
  onClose: () => void
}

type LoadState = 'loading' | 'ready' | 'error'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 1.5
const ZOOM_STEP = 0.1

const MIN_W = 420
const MIN_H = 320
const INITIAL_W = 640
const INITIAL_H = 480

/**
 * 在线词典浮层 — 用 Electron <webview> 加载词典站点。
 *
 * 之所以不用 iframe：多数词典站（如有道）通过 X-Frame-Options / CSP
 * frame-ancestors 禁止被嵌入，iframe 会显示空白且 Chromium 不触发任何
 * 事件。webview 是独立的 guest 页面，不受该限制。
 * 安全（node 关闭、sandbox、仅 https）由主进程 will-attach-webview 强制。
 *
 * 页面适配：词典页用 CSS zoom（executeJavaScript 注入）缩放；浮层右下角
 * 可拖拽调整大小。
 */
export function DictionaryPopup({ word, onClose }: DictionaryPopupProps): React.ReactElement {
  const [url, setUrl] = useState(() => buildDictUrl(loadDictConfig().template, word))
  const [status, setStatus] = useState<LoadState>('loading')
  const [zoom, setZoom] = useState(() => loadDictPopupPrefs().zoom)
  const [size, setSize] = useState(() => {
    const p = loadDictPopupPrefs()
    return { w: p.width, h: p.height }
  })
  // 居中定位（按初始尺寸计算一次，拖拽调整大小时位置保持不动）。
  const [pos] = useState(() => ({
    left: Math.max(8, Math.round((window.innerWidth - INITIAL_W) / 2)),
    top: Math.max(8, Math.round((window.innerHeight - INITIAL_H) / 2))
  }))
  const sizeRef = useRef(size)
  const rootRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<HTMLElement | null>(null)
  const userAdjustedZoom = useRef(false)
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

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

  /**
   * Scale the dictionary page via CSS zoom injected into the guest page.
   * Deterministic and immediate — unlike webContents.setZoomFactor it does
   * not depend on webview API availability/timing.
   */
  const applyZoom = (z: number) => {
    const wv = webviewRef.current as (HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> }) | null
    if (!wv?.executeJavaScript) return
    try {
      void wv.executeJavaScript(`document.documentElement.style.zoom = ${z.toFixed(2)}`)
    } catch {
      // webview not ready — the next dom-ready applies the default zoom
    }
  }

  // Track the webview's load state; apply the default zoom on first load.
  useEffect(() => {
    const wv = webviewRef.current as (HTMLElement & {
      addEventListener: (t: string, fn: () => void) => void
      removeEventListener: (t: string, fn: () => void) => void
    }) | null
    /* v8 ignore next -- @preserve */
    if (!wv) return
    const onReady = () => {
      setStatus('ready')
      if (!userAdjustedZoom.current) applyZoom(loadDictPopupPrefs().zoom)
    }
    const onFail = () => setStatus('error')
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('did-fail-load', onFail)
    }
  }, [url])

  const changeZoom = (delta: number) => {
    /* v8 ignore next -- @preserve */
    if (status !== 'ready') return
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((zoom + delta) * 10) / 10))
    setZoom(next)
    userAdjustedZoom.current = true
    applyZoom(next)
    const p = loadDictPopupPrefs()
    saveDictPopupPrefs({ ...p, zoom: next })
  }

  // Resize by dragging the bottom-right handle.
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
    const onMove = (ev: MouseEvent) => {
      const s = resizeStart.current
      /* v8 ignore next -- @preserve */
      if (!s) return
      const next = {
        w: Math.max(MIN_W, s.w + (ev.clientX - s.x)),
        h: Math.max(MIN_H, s.h + (ev.clientY - s.y))
      }
      sizeRef.current = next
      setSize(next)
    }
    const onUp = () => {
      resizeStart.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      // Persist the resized dimensions for next time.
      const p = loadDictPopupPrefs()
      saveDictPopupPrefs({ ...p, width: sizeRef.current.w, height: sizeRef.current.h })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const openInBrowser = () => {
    void window.sophia.app.openExternal(url)
    onClose()
  }

  return (
    <div
      ref={rootRef}
      className="fixed z-40 flex flex-col overflow-hidden rounded-xl border border-surface-border-strong bg-bg-surface shadow-2xl"
      style={{
        width: size.w,
        height: size.h,
        left: pos.left,
        top: pos.top
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
              disabled={status !== 'ready'}
              className="rounded px-1 hover:bg-bg-elevated disabled:opacity-40"
              title="缩小"
            >
              −
            </button>
            <span className="w-9 text-center tabular-nums text-text-muted">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => changeZoom(ZOOM_STEP)}
              disabled={status !== 'ready'}
              className="rounded px-1 hover:bg-bg-elevated disabled:opacity-40"
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

      {/* Resize handle (bottom-right) */}
      <div
        onMouseDown={onResizeStart}
        className="absolute bottom-0 right-0 z-20 h-4 w-4 cursor-nwse-resize"
        title="拖动调整大小"
      >
        <svg viewBox="0 0 16 16" className="h-full w-full text-text-muted">
          <path d="M12 4 L12 12 L4 12 Z" fill="currentColor" opacity="0.6" />
        </svg>
      </div>
    </div>
  )
}
