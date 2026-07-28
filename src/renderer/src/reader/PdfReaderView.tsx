import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface PdfReaderViewProps {
  textbookId: string
  title: string
  onClose: () => void
}

export function PdfReaderView({ textbookId, title, onClose }: PdfReaderViewProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.5)
  const [error, setError] = useState('')

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
    })()
    return () => {
      cancelled = true
    }
  }, [doc, pageNum, scale])

  const fitWidth = async () => {
    if (!doc || !containerRef.current) return
    const page = await doc.getPage(pageNum)
    const base = page.getViewport({ scale: 1 })
    setScale((containerRef.current.clientWidth - 32) / base.width)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-deep">
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-2">
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            disabled={pageNum <= 1}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-xs text-text-secondary">
            {pageNum} / {pageCount || '…'}
          </span>
          <button
            onClick={() => setPageNum((p) => Math.min(pageCount, p + 1))}
            disabled={pageNum >= pageCount}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated disabled:opacity-50"
          >
            下一页
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
      <div ref={containerRef} className="flex-1 overflow-auto p-4 text-center">
        {error ? (
          <p className="mt-8 text-sm text-red-400">{error}</p>
        ) : (
          <canvas ref={canvasRef} className="mx-auto shadow-lg" />
        )}
      </div>
    </div>
  )
}
