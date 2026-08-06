import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import mermaid from 'mermaid'
import { useTTS, stripMarkdown } from '../hooks/useTTS'
import { TTSControlPanel } from '../components/TTSControlPanel'
import { normalizeMathDelimiters } from '../../../shared/math-delimiters'
import { rehypeTexSource, handleCopyMathSource } from '../lib/mathCopy'

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose'
})

export type MessageHighlight = 'none' | 'match' | 'current'

interface ChatMessageProps {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  showActions?: boolean
  /** In-conversation search highlight state. */
  highlight?: MessageHighlight
  /** Textbook id used by the in-message citation chip (「查看教材原文」). */
  textbookId?: string | null
  onEdit?: (id: string, content: string) => void
  onDelete?: (id: string) => void
  onRegenerate?: (id: string) => void
  /** Rewind the conversation to this message (drop everything after it). */
  onRewind?: (id: string) => void
}

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useRef(`mermaid-${Math.random().toString(36).slice(2, 10)}`)

  useEffect(() => {
    if (!ref.current) return
    mermaid.render(id.current, code).then(({ svg }) => {
      if (ref.current) {
        ref.current.innerHTML = svg
        setError(null)
      }
    }).catch((e) => {
      setError(String(e))
    })
  }, [code])

  if (error) {
    return <pre className="text-xs text-red-400 overflow-auto"><code>{code}</code></pre>
  }
  return <div ref={ref} className="my-2 flex justify-center" />
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }, [text])
  return (
    <button
      onClick={(e) => { e.stopPropagation(); handleCopy() }}
      className={`text-xs px-2 py-0.5 rounded transition-colors ${
        copied
          ? 'bg-green-700 text-green-200'
          : 'text-text-muted hover:text-text-secondary hover:bg-bg-elevated'
      }`}
      title="复制"
      aria-label="复制消息内容"
    >
      {copied ? '已复制' : '📋'}
    </button>
  )
}

function CitationChip({ textbookId, chapter }: { textbookId?: string | null; chapter: string }) {
  const [panel, setPanel] = useState<null | 'source' | 'translation'>(null)
  const [data, setData] = useState<{ excerpt?: string; translation?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const load = async (mode: 'source' | 'translation') => {
    if (!textbookId) return
    if (panel === mode) {
      setPanel(null)
      return
    }
    setPanel(mode)
    setLoading(true)
    setErrorMsg('')
    setData(null)
    try {
      if (mode === 'source') {
        const result = await window.sophia.data.searchTextbookExcerpt(textbookId, chapter)
        if (!result) {
          setErrorMsg('未在教材中找到对应章节')
          return
        }
        setData({ excerpt: result.excerpt })
      } else {
        const result = await window.sophia.data.translateTextbookExcerpt(textbookId, chapter)
        if (!result) {
          setErrorMsg('翻译不可用（可能未配置模型）')
          return
        }
        setData({ excerpt: result.excerpt, translation: result.translation })
      }
    } catch {
      setErrorMsg('读取失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <span className="relative inline-flex flex-col items-start">
      <span className="mb-1 flex flex-wrap gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); load('source') }}
          disabled={!textbookId}
          className="rounded border border-accent-border bg-accent-subtle px-2 py-0.5 text-xs text-accent-hover hover:bg-accent-subtle/70 disabled:opacity-50"
          title={textbookId ? '查看教材原文' : '当前课堂未绑定教材'}
          aria-label={textbookId ? '查看教材原文' : '未绑定教材'}
        >
          📖 教材原文 · {chapter}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); load('translation') }}
          disabled={!textbookId}
          className="rounded border border-accent-border bg-accent-subtle px-2 py-0.5 text-xs text-accent-hover hover:bg-accent-subtle/70 disabled:opacity-50"
          title={textbookId ? '把这段教材原文翻译成中文' : '当前课堂未绑定教材'}
          aria-label={textbookId ? '翻译教材原文' : '未绑定教材'}
        >
          🌐 翻译
        </button>
      </span>
      {panel && (
        <span className="absolute left-0 top-full z-30 mt-1 block w-80 whitespace-pre-wrap rounded-lg border border-surface-border bg-bg-surface p-3 text-xs leading-relaxed text-text-secondary shadow-lg">
          {loading ? (
            '加载中...'
          ) : errorMsg ? (
            errorMsg
          ) : panel === 'source' ? (
            data?.excerpt
          ) : (
            <>
              <p className="mb-2 text-[10px] font-medium uppercase text-text-muted">原文</p>
              <p className="mb-3">{data?.excerpt}</p>
              <p className="mb-1 text-[10px] font-medium uppercase text-text-muted">译文</p>
              <p>{data?.translation}</p>
            </>
          )}
        </span>
      )}
    </span>
  )
}

function SpeakButton({ text }: { text: string }) {
  const tts = useTTS('zh-CN')
  const [open, setOpen] = useState(false)

  // Close the control panel when the utterance finishes or is stopped.
  useEffect(() => {
    if (!tts.speaking) setOpen(false)
  }, [tts.speaking])

  if (!tts.supported) return null

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (tts.speaking) {
      tts.stop()
      setOpen(false)
      return
    }
    tts.speak(stripMarkdown(text))
    setOpen(true)
  }

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        className={`text-xs px-1 transition-colors ${
          tts.speaking
            ? 'text-accent'
            : 'text-text-muted hover:text-text-secondary'
        }`}
        title={tts.speaking ? '停止朗读' : '朗读'}
        aria-label={tts.speaking ? '停止朗读' : '朗读'}
      >
        {tts.speaking ? '⏹️' : '🔊'}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1">
          <TTSControlPanel tts={tts} />
        </div>
      )}
    </div>
  )
}

export function ChatMessage({
  id,
  role,
  content,
  showActions,
  highlight = 'none',
  textbookId,
  onEdit,
  onDelete,
  onRegenerate,
  onRewind
}: ChatMessageProps): React.ReactElement {
  const isUser = role === 'user'
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(content)
  const editRef = useRef<HTMLTextAreaElement>(null)

  const highlightClasses =
    highlight === 'current'
      ? 'ring-2 ring-amber-400'
      : highlight === 'match'
        ? 'ring-1 ring-amber-400/50'
        : ''

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus()
      editRef.current.setSelectionRange(editRef.current.value.length, editRef.current.value.length)
    }
  }, [editing])

  const handleSaveEdit = () => {
    if (editText.trim() && editText !== content) {
      onEdit?.(id, editText)
    }
    setEditing(false)
  }

  const rendered = useMemo(() => {
    return (
      <div
        onCopy={handleCopyMathSource}
        className={isUser
          ? 'text-sm leading-relaxed whitespace-pre-wrap'
          : 'markdown-body text-sm leading-relaxed'}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeTexSource, rehypeKatex, rehypeHighlight]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className ?? '')
              const code = String(children).replace(/\n$/, '')
              if (match?.[1] === 'mermaid') {
                return <MermaidBlock code={code} />
              }
              return <code className={className} {...props}>{children}</code>
            },
            pre({ children }) {
              const codeText = extractText(children)
              return (
                <div className="group relative">
                  <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <CopyButton text={codeText} />
                  </div>
                  <pre>{children}</pre>
                </div>
              )
            },
            blockquote({ children }) {
              const text = extractText(children)
              const m = /【教材出处 · 《([^】]+)》 · ([^】]+)】/.exec(text)
              if (!m) return <blockquote>{children}</blockquote>
              return (
                <blockquote>
                  <CitationChip textbookId={textbookId} chapter={m[2].trim()} />
                  {children}
                </blockquote>
              )
            }
          }}
        >
          {normalizeMathDelimiters(content)}
        </ReactMarkdown>
      </div>
    )
  }, [content, id, isUser])

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} group`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${highlightClasses} ${
          isUser
            ? 'bg-accent text-white'
            : 'bg-bg-elevated text-text-primary'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-2">
                <textarea
                  ref={editRef}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      handleSaveEdit()
                    }
                    if (e.key === 'Escape') {
                      setEditing(false)
                      setEditText(content)
                    }
                  }}
                  className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-border resize-none"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveEdit}
                    className="text-xs bg-accent px-2 py-1 rounded text-white hover:bg-accent-hover"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => { setEditing(false); setEditText(content) }}
                    className="text-xs text-text-muted hover:text-text-secondary"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              rendered
            )}
          </div>
              {showActions && !editing && (
            <div className="flex-shrink-0 flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
              <CopyButton text={content} />
              {role === 'assistant' && <SpeakButton text={content} />}
              {onRewind && (
                <button
                  onClick={() => onRewind(id)}
                  className="text-xs text-text-muted hover:text-text-secondary px-1"
                  title="从这里重新开始（删除其后所有消息）"
                  aria-label="从这里重新开始"
                >
                  ↩️
                </button>
              )}
              {onEdit && (
                <button
                  onClick={() => { setEditText(content); setEditing(true) }}
                  className="text-xs text-text-muted hover:text-text-secondary px-1"
                  title="编辑"
                  aria-label="编辑消息"
                >
                  ✏️
                </button>
              )}
              {onRegenerate && role === 'assistant' && (
                <button
                  onClick={() => onRegenerate(id)}
                  className="text-xs text-text-muted hover:text-text-secondary px-1"
                  title="重新生成"
                  aria-label="重新生成回复"
                >
                  🔄
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => onDelete(id)}
                  className="text-xs text-text-muted hover:text-red-400 px-1"
                  title="删除"
                  aria-label="删除消息"
                >
                  🗑️
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as any).props.children)
  }
  return ''
}
