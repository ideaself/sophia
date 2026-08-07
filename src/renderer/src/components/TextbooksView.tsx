import { useState, lazy, Suspense } from 'react'
import { PdfReaderView } from '../reader/PdfReaderView'
import { EpubReaderView } from '../reader/EpubReaderView'
import { useTextbookStore } from '../stores/useTextbookStore'
import { WORLD_ID, type Textbook } from '../types/models'

const MarkdownRenderer = lazy(() => import('../lib/MarkdownRenderer'))

export function TextbooksView(): React.ReactElement {
  const textbooks = useTextbookStore((s) => s.textbooks)
  const fetchTextbooks = useTextbookStore((s) => s.fetch)
  const selectTextbook = useTextbookStore((s) => s.select)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [readingTextbook, setReadingTextbook] = useState<Textbook | null>(null)
  const [viewingTextbook, setViewingTextbook] = useState<Textbook | null>(null)
  const [viewingContent, setViewingContent] = useState('')
  const [loadingContent, setLoadingContent] = useState(false)
  const [editingTextbook, setEditingTextbook] = useState<Textbook | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  // EPUB 正文缺失修复（旧版解析器导入的教材只有书名+作者）
  const [repairingIds, setRepairingIds] = useState<Set<string>>(new Set())
  const [repairMsg, setRepairMsg] = useState<string | null>(null)

  /** 旧版解析器导入的 EPUB：正文只有书名+作者，需要从原件重新提取。 */
  const isContentMissing = (t: Textbook): boolean =>
    t.format === 'epub' &&
    !!t.originalFile &&
    (t.content ?? '').trim().length < 200 &&
    !(t.content ?? '').includes('\n')

  const missingCount = textbooks.filter(isContentMissing).length

  const repairEpub = async (t: Textbook) => {
    setRepairingIds((prev) => new Set(prev).add(t.id))
    setRepairMsg(null)
    try {
      const result = await window.sophia.data.reparseEpubContent(t.id)
      setRepairMsg(result.success && result.content.trim()
        ? `「${t.title}」已重新提取正文（${result.content.trim().length} 字）`
        : `「${t.title}」重新提取失败`)
      fetchTextbooks()
    } catch (err) {
      setRepairMsg(`「${t.title}」重新提取失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setRepairingIds((prev) => {
        const next = new Set(prev)
        next.delete(t.id)
        return next
      })
    }
  }

  const repairAllMissing = async () => {
    const targets = textbooks.filter(isContentMissing)
    for (const t of targets) {
      await repairEpub(t)
    }
  }

  const handleTextImport = async () => {
    if (!title.trim()) return
    setImporting(true)
    setError('')
    try {
      await window.sophia.data.createTextbook({
        worldId: WORLD_ID,
        title: title.trim(),
        format: 'markdown',
        content
      })
      setTitle('')
      setContent('')
      fetchTextbooks()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const handleFileImport = async () => {
    setImporting(true)
    setError('')
    try {
      const result = await window.sophia.dialog.openFile()
      if (result.canceled || !result.filePaths[0]) {
        setImporting(false)
        return
      }

      const filePath = result.filePaths[0]
      const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
      const fileName = filePath.split(/[/\\]/).pop() ?? filePath
      const autoTitle = fileName.replace(/\.[^.]+$/, '')

      let format: 'pdf' | 'epub' | 'markdown' | 'text' = 'markdown'
      if (ext === 'pdf') format = 'pdf'
      else if (ext === 'epub') format = 'epub'
      else if (ext === 'txt') format = 'text'

      await window.sophia.data.createTextbook({
        worldId: WORLD_ID,
        title: title.trim() || autoTitle,
        format,
        sourceFile: filePath
      })
      setTitle('')
      fetchTextbooks()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const handleViewContent = async (t: Textbook) => {
    setViewingTextbook(t)
    setLoadingContent(true)
    try {
      const full = await window.sophia.data.getTextbook(t.id)
      let content = full?.content ?? ''
      // EPUBs imported before the parser's raw-file fallback may only contain
      // "title + author" — re-extract the body from the original file.
      if (
        t.format === 'epub' &&
        content.trim().length < 200 &&
        !content.includes('\n') &&
        t.originalFile
      ) {
        try {
          const result = await window.sophia.data.reparseEpubContent(t.id)
          if (result.success && result.content.trim()) {
            content = result.content
          }
        } catch {
          // keep whatever we had
        }
      }
      setViewingContent(content)
    } catch {
      setViewingContent('加载失败')
    } finally {
      setLoadingContent(false)
    }
  }

  const handleEdit = async (t: Textbook) => {
    setEditingTextbook(t)
    setEditTitle(t.title)
    try {
      const full = await window.sophia.data.getTextbook(t.id)
      setEditContent(full?.content ?? "")
    } catch {
      setEditContent("")
    }
  }

  const handleSaveEdit = async () => {
    if (!editingTextbook || !editTitle.trim()) return
    setSaving(true)
    try {
      await window.sophia.data.updateTextbook(editingTextbook.id, { title: editTitle.trim(), content: editContent })
      setEditingTextbook(null)
      fetchTextbooks()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async (t: Textbook) => {
    await window.sophia.data.deleteTextbook(t.id)
    setDeleteConfirmId(null)
    fetchTextbooks()
  }

  return (
    <div className="p-8">
      <h2 className="mb-6 text-2xl font-bold">教材</h2>

      <div className="mb-8 rounded-lg border border-surface-border bg-bg-surface p-6">
        <h3 className="mb-4 text-lg font-semibold">导入教材</h3>
        <div className="space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="教材标题（从文件导入时可留空）"
            className="w-full rounded border border-surface-border-strong bg-bg-deep px-4 py-2 text-sm text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="粘贴 Markdown 或文本内容..."
            rows={6}
            className="w-full rounded border border-surface-border-strong bg-bg-deep px-4 py-2 text-sm text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
          />
          <div className="flex gap-3">
            <button
              onClick={handleTextImport}
              disabled={importing || !title.trim() || !content.trim()}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {importing ? '导入中...' : '粘贴导入'}
            </button>
            <button
              onClick={handleFileImport}
              disabled={importing}
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              {importing ? '解析中...' : '从文件导入 (PDF/EPUB)'}
            </button>
          </div>
          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {missingCount > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-2.5">
            <p className="text-sm text-text-secondary">
              ⚠️ {missingCount} 本 EPUB 正文缺失（旧版解析器只提取到了书名和作者）。
              点「重新提取」即可从原件修复，无需重新导入。
            </p>
            <button
              onClick={() => void repairAllMissing()}
              disabled={repairingIds.size > 0}
              className="flex-shrink-0 rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {repairingIds.size > 0 ? '提取中...' : '全部重新提取'}
            </button>
          </div>
        )}
        {repairMsg && (
          <p className="text-xs text-green-400">{repairMsg}</p>
        )}
        {textbooks.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between rounded-lg border border-surface-border bg-bg-surface p-4"
          >
            <div>
              <h4 className="font-medium">{t.title}</h4>
              <p className="text-xs text-text-muted">{t.format}</p>
              {isContentMissing(t) && (
                <button
                  onClick={() => void repairEpub(t)}
                  disabled={repairingIds.has(t.id)}
                  className="mt-1 rounded border border-amber-800 px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-900/30 disabled:opacity-50"
                  title="旧版解析器导入的 EPUB 正文缺失，从原件重新提取"
                >
                  {repairingIds.has(t.id) ? '提取中...' : '⚠️ 正文缺失 · 重新提取'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {t.originalFile && (
                <button
                  onClick={() => setReadingTextbook(t)}
                  className="rounded border border-surface-border-strong px-3 py-1 text-sm hover:bg-bg-elevated"
                >
                  阅读原件
                </button>
              )}
              <button
                onClick={() => handleViewContent(t)}
                className="rounded border border-surface-border-strong px-3 py-1 text-sm hover:bg-bg-elevated"
              >
                查看
              </button>
              <button
                onClick={() => handleEdit(t)}
                className="rounded border border-surface-border-strong px-3 py-1 text-sm hover:bg-bg-elevated"
              >
                编辑
              </button>
              {deleteConfirmId === t.id ? (
                <>
                  <button
                    onClick={() => confirmDelete(t)}
                    className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500"
                  >
                    确认删除
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="rounded border border-surface-border-strong px-3 py-1 text-sm hover:bg-bg-elevated"
                  >
                    取消
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setDeleteConfirmId(t.id)}
                  className="rounded border border-surface-border-strong px-3 py-1 text-sm text-red-400 hover:bg-red-900/30"
                >
                  删除
                </button>
              )}
              <button
                onClick={() => selectTextbook(t)}
                className="rounded bg-accent px-3 py-1 text-sm text-white hover:bg-accent-hover"
              >
                选择
              </button>
            </div>
          </div>
        ))}
        {textbooks.length === 0 && (
          <p className="text-text-muted">暂无教材。请在上方导入。</p>
        )}
      </div>

      {editingTextbook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex h-[80vh] w-[80vw] flex-col rounded-lg border border-surface-border-strong bg-bg-deep shadow-xl">
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
              <h3 className="text-lg font-semibold">编辑教材</h3>
              <button
                onClick={() => setEditingTextbook(null)}
                className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="教材标题"
                className="w-full rounded border border-surface-border-strong bg-bg-surface px-4 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
              />
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="教材内容 (Markdown)..."
                className="h-full w-full rounded border border-surface-border-strong bg-bg-surface px-4 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
                style={{ minHeight: '50vh' }}
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-surface-border px-6 py-4">
              <button
                onClick={() => setEditingTextbook(null)}
                className="rounded border border-surface-border-strong px-4 py-2 text-sm hover:bg-bg-elevated"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving || !editTitle.trim()}
                className="rounded bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewingTextbook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex h-[80vh] w-[80vw] flex-col rounded-lg border border-surface-border-strong bg-bg-deep shadow-xl">
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold">{viewingTextbook.title}</h3>
                <p className="text-xs text-text-muted">{viewingTextbook.format}</p>
              </div>
              <button
                onClick={() => setViewingTextbook(null)}
                className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4">
              {loadingContent ? (
                <p className="text-sm text-text-muted">加载中...</p>
              ) : (
                <div className="markdown-body text-sm leading-relaxed text-text-secondary">
                  <Suspense fallback={null}>
                    <MarkdownRenderer>
                      {viewingContent}
                    </MarkdownRenderer>
                  </Suspense>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {readingTextbook && readingTextbook.format === 'epub' && (
        <EpubReaderView
          textbookId={readingTextbook.id}
          title={readingTextbook.title}
          onClose={() => setReadingTextbook(null)}
        />
      )}
      {readingTextbook && readingTextbook.format !== 'epub' && (
        <PdfReaderView
          textbookId={readingTextbook.id}
          title={readingTextbook.title}
          onClose={() => setReadingTextbook(null)}
        />
      )}
    </div>
  )
}
