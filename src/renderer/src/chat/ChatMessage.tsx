import { memo, useMemo, useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { useTTS, stripMarkdown } from '../hooks/useTTS'
import { TTSControlPanel } from '../components/TTSControlPanel'
import { MermaidBlock } from '../components/MermaidBlock'
import { SelfTestBlock } from '../components/SelfTestBlock'
import { normalizeMathDelimiters } from '../../../shared/math-delimiters'
import { parseSelfTestQuestions } from '../../../shared/self-test-utils'
import { parseEventCard, type EventCard } from '../../../shared/event-cards'
import { handleCopyMathSource } from '../lib/mathCopy'

const MarkdownRenderer = lazy(() => import('../lib/MarkdownRenderer'))

export type MessageHighlight = 'none' | 'match' | 'current'

interface ChatMessageProps {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 消息时间（本地乐观消息可能为空）。 */
  createdAt?: string
  showActions?: boolean
  /** In-conversation search highlight state. */
  highlight?: MessageHighlight
  /** Textbook id used by the in-message citation chip (「查看教材原文」). */
  textbookId?: string | null
  /** 轻量 grounding 提醒：知识性回答未引用教材出处时展示小字警示。 */
  showGroundingNotice?: boolean
  onEdit?: (id: string, content: string) => void
  onDelete?: (id: string) => void
  onRegenerate?: (id: string) => void
  /** Rewind the conversation to this message (drop everything after it). */
  onRewind?: (id: string) => void
}

const CARD_STYLES: Record<EventCard['kind'], { frame: string; badge: string; label: string }> = {
  hint: {
    frame: 'border-amber-700/40 bg-amber-900/10',
    badge: 'bg-amber-900/30 text-amber-500',
    label: '💡 导师提示'
  },
  correction: {
    frame: 'border-red-800/40 bg-red-900/10',
    badge: 'bg-red-900/30 text-red-400',
    label: '⚠️ 纠正一下'
  },
  memory: {
    frame: 'border-indigo-700/40 bg-indigo-900/10',
    badge: 'bg-indigo-900/30 text-indigo-400',
    label: '🧠 建议记忆'
  }
}

/** 事件卡片（提示 / 纠错 / 记忆提议）：徽标 + 内容，卡片块后其余内容照常渲染。 */
function EventCardBlock({ card }: { card: EventCard }): React.ReactElement {
  const style = CARD_STYLES[card.kind]
  return (
    <div className="space-y-2">
      <div className={`rounded-xl border ${style.frame} p-3`}>
        <span className={`mb-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${style.badge}`}>
          {style.label}
        </span>
        <div className="text-sm leading-relaxed text-text-secondary">
          <Suspense fallback={null}>
            <MarkdownRenderer>{normalizeMathDelimiters(card.body)}</MarkdownRenderer>
          </Suspense>
        </div>
      </div>
      {card.rest.trim() && (
        <Suspense fallback={null}>
          <MarkdownRenderer>{normalizeMathDelimiters(card.rest)}</MarkdownRenderer>
        </Suspense>
      )}
    </div>
  )
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

export const ChatMessage = memo(function ChatMessage({
  id,
  role,
  content,
  createdAt,
  showActions,
  highlight = 'none',
  textbookId,
  showGroundingNotice = false,
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
      ? 'ring-2 ring-amber-500'
      : highlight === 'match'
        ? 'ring-1 ring-amber-500/50'
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
    // Event-card parsing scans the whole message with regexes and returns a
    // fresh object — keeping it inside this memo (keyed on `content`) is what
    // stops every token tick from re-parsing every visible message.
    const eventCard = isUser ? null : parseEventCard(content)
    // 课堂测验卡片化（里程碑 2）：assistant 回复若含 **自测 N：** 结构化题目，渲染为逐级揭晓卡片
    const questions = isUser || eventCard ? [] : parseSelfTestQuestions(content)
    const quizMode = questions.length > 0

    const intro = (() => {
      if (!quizMode) return ''
      const lines = content.split('\n')
      const first = lines.findIndex((l) => /^\s*[-*]?\s*\*{0,2}自测\s*\d*\s*[：:]/.test(l))
      return first > 0 ? lines.slice(0, first).join('\n') : ''
    })()

    const body = eventCard ? (
      <EventCardBlock card={eventCard} />
    ) : quizMode ? (
      <>
        {intro.trim() && (
          <Suspense fallback={null}>
            <MarkdownRenderer>{normalizeMathDelimiters(intro)}</MarkdownRenderer>
          </Suspense>
        )}
        <div className="mt-2">
          <SelfTestBlock questions={questions} />
        </div>
      </>
    ) : (
      <Suspense fallback={<span className="text-xs text-text-muted">渲染中…</span>}>
        <MarkdownRenderer
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
        </MarkdownRenderer>
      </Suspense>
    )

    return (
      <div
        onCopy={handleCopyMathSource}
        className={isUser
          ? 'text-sm leading-relaxed whitespace-pre-wrap'
          : 'markdown-body text-sm leading-relaxed'}>
        {body}
      </div>
    )
  }, [content, isUser, textbookId])

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
            {createdAt && !editing && (
              <p className={`mt-1 text-[10px] leading-none ${isUser ? 'text-right text-white/50' : 'text-text-muted'}`}>
                {new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            {showGroundingNotice && !isUser && !editing && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-amber-600/90">
                ⚠️ 本次回答未引用教材出处，内容待核实
              </p>
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
})

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: React.ReactNode } }).props
    return extractText(props?.children)
  }
  return ''
}
