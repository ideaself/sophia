import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose'
})

interface ChatMessageProps {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  showActions?: boolean
  onEdit?: (id: string, content: string) => void
  onDelete?: (id: string) => void
  onRegenerate?: (id: string) => void
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
    >
      {copied ? '已复制' : '📋'}
    </button>
  )
}

export function ChatMessage({ id, role, content, showActions, onEdit, onDelete, onRegenerate }: ChatMessageProps): React.ReactElement {
  const isUser = role === 'user'
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(content)
  const editRef = useRef<HTMLTextAreaElement>(null)

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
    if (isUser) return null
    return (
      <div className="markdown-body text-sm leading-relaxed">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypeHighlight]}
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
            }
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    )
  }, [content, id])

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} group`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
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
                    if (e.key === 'Enter' && !e.shiftKey) {
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
            ) : isUser ? (
              <p className="whitespace-pre-wrap text-sm">{content}</p>
            ) : (
              rendered
            )}
          </div>
          {showActions && !editing && (
            <div className="flex-shrink-0 flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
              <CopyButton text={content} />
              {onEdit && (
                <button
                  onClick={() => { setEditText(content); setEditing(true) }}
                  className="text-xs text-text-muted hover:text-text-secondary px-1"
                  title="编辑"
                >
                  ✏️
                </button>
              )}
              {onRegenerate && role === 'assistant' && (
                <button
                  onClick={() => onRegenerate(id)}
                  className="text-xs text-text-muted hover:text-text-secondary px-1"
                  title="重新生成"
                >
                  🔄
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => onDelete(id)}
                  className="text-xs text-text-muted hover:text-red-400 px-1"
                  title="删除"
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
