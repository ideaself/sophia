import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useChatStream } from './useChatStream'
import { ChatMessage, type MessageHighlight } from './ChatMessage'
import { ThinkingBlock } from '../components/ThinkingBlock'
import { stopTTS } from '../hooks/useTTS'
import { loadTabs, saveTabs, serializeTabs } from '../../../shared/tab-persistence'
import { useAppStore } from '../stores/useAppStore'
import { loadTextTemplates, MAX_TEXT_TEMPLATES } from '../../../shared/text-templates'
import { detectVoiceTrigger, loadVoiceTriggers } from '../../../shared/voice-trigger'
import { useTodayStudyMinutes } from '../hooks/useTodayStudyMinutes'
import { loadThinkingMode, shouldUseThinking } from '../../../shared/thinking'
import { isKnowledgeQuestion, hasTextbookCitation } from '../../../shared/grounding'

// PDF/EPUB 阅读器体积大（pdfjs 等），打开阅读分栏时才加载
const EpubReaderView = lazy(() => import('../reader/EpubReaderView').then((m) => ({ default: m.EpubReaderView })))
const PdfReaderView = lazy(() => import('../reader/PdfReaderView').then((m) => ({ default: m.PdfReaderView })))

interface Companion {
  id: string
  name: string
  identity: string
}

interface Textbook {
  id: string
  title: string
  format?: string
  originalFile?: string
}

interface ClassroomViewProps {
  companion: Companion | null
  textbook: Textbook | null
  chatStream: ReturnType<typeof useChatStream>
  loadConversationId?: string | null
  onConversationLoaded?: () => void
  /** > 0 表示这是「新建课堂」的启动：忽略持久化的旧标签页，从空白对话开始。 */
  freshStartNonce?: number
}

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 消息时间（仅持久化消息有；本地乐观消息为空则不显示）。 */
  createdAt?: string
}

interface TabState {
  id: string
  title: string
  conversationId: string | null
  classMode: 'standard' | 'feynman'
  pace: 'slow' | 'normal' | 'fast'
  messages: DisplayMessage[]
  input: string
  retryMessage: { input: string; convId: string } | null
  endResult: {
    artifacts: number
    farewell?: string
    failures?: string[]
    conversationId?: string
    pending?: boolean
    generationError?: string
  } | null
}

type MessageRow =
  | {
      kind: 'message'
      key: string
      msg: DisplayMessage
      showThinking: boolean
      highlight: MessageHighlight
    }
  | { kind: 'error'; key: string }
  | { kind: 'end'; key: string }

const MAX_INPUT_LENGTH = 20000

/** 课堂快捷操作（里程碑 2）：预置教学指令，点击直接发送。 */
const QUICK_ACTIONS: Array<{ label: string; prompt: string; title: string }> = [
  {
    label: '继续追问',
    prompt: '继续追问：请接着刚才的话题，再问一个更深的问题，检验我的理解。',
    title: '让导师继续提问'
  },
  {
    label: '给我提示',
    prompt: '给我一点提示，但不要直接给答案。请用引用块格式回复：> 💡 提示：<提示内容>',
    title: '请求一个提示（以提示卡片呈现）'
  },
  {
    label: '换种解释',
    prompt: '刚才讲得有点抽象，换个角度、用更直观的方式再解释一遍。',
    title: '换一种解释方式'
  },
  {
    label: '举个例子',
    prompt: '举个例子说明刚才的内容，越具体越好。',
    title: '请求一个具体例子'
  },
  {
    label: '考考我',
    prompt: '考考我：出 1-2 道题检验我是否掌握刚才的内容。格式要求：每道题用 **自测 N：<问题>** 开头，下面依次是 - 提示 1：、- 提示 2：、- 答案：，答案放最后。',
    title: '导师出题（会以测验卡片呈现）'
  },
  {
    label: '总结本节',
    prompt: '总结一下刚才讲的内容，列出核心要点。',
    title: '总结当前进度'
  },
  {
    label: '生成卡片',
    prompt: '把刚才讲的内容生成 3 张记忆卡片（格式：- 问题：…\n- 答案：…）。',
    title: '生成记忆卡片'
  },
  {
    label: '加入复习',
    prompt: '把刚才讲的核心概念加入我的复习计划，用引用块格式列出建议记忆的卡片：> 🧠 建议记忆：<问题> - <答案>，一卡一行。',
    title: '标记概念进入复习（以记忆卡片呈现）'
  }
]

const MATH_SYMBOL_GROUPS: Array<{ id: string; label: string; items: string[] }> = [
  {
    id: 'greek',
    label: '希腊字母',
    items: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω', 'Γ', 'Δ', 'Θ', 'Λ', 'Ξ', 'Π', 'Σ', 'Φ', 'Ψ', 'Ω']
  },
  {
    id: 'ops',
    label: '运算符号',
    items: ['+', '−', '×', '÷', '±', '∓', '=', '≠', '≈', '<', '>', '≤', '≥', '∞', '∂', '∇', '∫', '∬', '∑', '∏', '√', '∛', '∜', '%', '‰']
  },
  {
    id: 'sets',
    label: '集合逻辑',
    items: ['∈', '∉', '⊂', '⊃', '⊆', '⊇', '∪', '∩', '∅', '∧', '∨', '¬', '→', '⇒', '↔', '⇔', '∀', '∃', '∴', '∵', '∥', '⊥']
  },
  {
    id: 'templates',
    label: '公式模板',
    items: ['\\frac{a}{b}', '\\sqrt{x}', 'x^{2}', 'x_{i}', '\\sum_{i=1}^{n}', '\\int_{a}^{b}', '\\lim_{x \\to 0}', '\\overrightarrow{AB}', '\\begin{cases} ... \\end{cases}']
  }
]

let tabCounter = 0
function newTabId(): string {
  tabCounter += 1
  return `tab_${Date.now()}_${tabCounter}`
}

function makeTab(conversationId?: string, title?: string): TabState {
  return {
    id: newTabId(),
    title: title ?? '新对话',
    conversationId: conversationId ?? null,
    classMode: 'standard',
    pace: 'normal',
    messages: [],
    input: '',
    retryMessage: null,
    endResult: null
  }
}

export function ClassroomView({ companion, textbook, chatStream, loadConversationId, onConversationLoaded, freshStartNonce = 0 }: ClassroomViewProps): React.ReactElement {
  const [initialTabs] = useState(() => freshStartNonce > 0 ? null : loadTabs(localStorage))
  const [tabs, setTabs] = useState<TabState[]>(() =>
    initialTabs
      ? initialTabs.tabs.map((t) => ({
          ...makeTab(t.conversationId ?? undefined, t.title),
          input: t.input
        }))
      : [makeTab()]
  )
  const [activeIdx, setActiveIdx] = useState(() => initialTabs?.activeIdx ?? 0)
  const [isLoading, setIsLoading] = useState(false)
  const [redoing, setRedoing] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const loadedIdRef = useRef<string | null>(null)
  // In-conversation search (Ctrl+F)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Quick text templates (1.0.7): Alt+1..9 inserts a saved snippet.
  const [templateOpen, setTemplateOpen] = useState(false)
  const templateRef = useRef<HTMLDivElement>(null)
  // AI 代答 (3.2.0 Ctrl+Shift+A): draft a learner reply to paste/send.
  const [aiAnswering, setAiAnswering] = useState(false)
  // 课堂内嵌教材阅读分栏（左右并排，宽度可拖拽调整）
  const [readerOpen, setReaderOpen] = useState(false)
  const [readerWidth, setReaderWidth] = useState(() => {
    try {
      const w = parseInt(localStorage.getItem('sophia.classroomReaderWidth') ?? '', 10)
      // 上限随视口变化：阅读器最宽 = 窗口宽 − 聊天区最小宽度。
      const maxW = Math.max(280, window.innerWidth - 360)
      return Number.isFinite(w) ? Math.min(maxW, Math.max(280, w)) : Math.min(480, maxW)
    } catch {
      return 480
    }
  })
  const readerResizeStart = useRef<{ x: number; w: number } | null>(null)
  const readerWidthRef = useRef(readerWidth)
  // Math symbol quick-insert panel
  const [mathOpen, setMathOpen] = useState(false)
  const [mathTab, setMathTab] = useState('greek')
  const mathRef = useRef<HTMLDivElement>(null)
  // Shortcut cheat sheet (Ctrl+/)
  const [showShortcuts, setShowShortcuts] = useState(false)
  // 每日学习目标（分钟，0 = 关闭）——设置页修改后通过事件同步
  const [dailyGoal, setDailyGoal] = useState(() => {
    const n = parseInt(localStorage.getItem('sophia.dailyGoal') ?? '', 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  })
  const todayMinutes = useTodayStudyMinutes()

  useEffect(() => {
    const onChange = () => {
      const n = parseInt(localStorage.getItem('sophia.dailyGoal') ?? '', 10)
      setDailyGoal(Number.isFinite(n) && n > 0 ? n : 0)
    }
    window.addEventListener('sophia:goal-changed', onChange)
    return () => window.removeEventListener('sophia:goal-changed', onChange)
  }, [])
  // Scroll behavior: stick to the bottom unless the user scrolls up
  const [stickToBottom, setStickToBottom] = useState(true)
  // Mirror of `tabs` for async callbacks — the render-closure `tabs` goes
  // stale inside .then() chains that run after later re-renders.
  const tabsRef = useRef(tabs)
  // 当前流式回复归属的标签索引。流式内容是全局单例状态，
  // 必须只显示在发起发送的标签上，避免切换标签时内容"串位"。
  const streamOwnerIdxRef = useRef<number | null>(null)
  // 发送中防重：覆盖"按下发送 → 流式开始"之间的间隙，避免连按 Enter
  // 重复创建会话 / 重复发送。
  const sendingRef = useRef(false)
  useEffect(() => { tabsRef.current = tabs }, [tabs])

  // Persist the tab strip (title / conversationId / draft) across restarts
  useEffect(() => {
    saveTabs(localStorage, serializeTabs(tabs, activeIdx))
  }, [tabs, activeIdx])

  // Keep activeIdx in range when tabs are removed
  useEffect(() => {
    if (activeIdx >= tabs.length) setActiveIdx(Math.max(0, tabs.length - 1))
  }, [tabs, activeIdx])

  // Hydrate restored tabs once: reload messages from the store and drop
  // tabs whose conversation no longer exists (e.g. deleted meanwhile).
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    const toHydrate = tabsRef.current.filter((t) => t.conversationId && t.messages.length === 0)
    for (const tab of toHydrate) {
      const conversationId = tab.conversationId!
      void (async () => {
        try {
          const conv = await window.sophia.data.getConversation(conversationId)
          if (!conv) {
            setTabs((prev) => {
              const next = prev.filter((x) => x.id !== tab.id)
              return next.length > 0 ? next : [makeTab()]
            })
            return
          }
          const msgs = await window.sophia.data.listMessages(conversationId)
          setTabs((prev) => {
            const i = prev.findIndex((x) => x.id === tab.id)
            if (i < 0) return prev
            const next = [...prev]
            next[i] = {
              ...next[i],
              messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt }))
            }
            return next
          })
        } catch {
          // Hydration is best-effort; the tab stays usable with empty messages
        }
      })()
    }
  }, [])

  const activeTab = tabs[activeIdx] ?? tabs[0]

  const updateTab = useCallback((idx: number, patch: Partial<TabState>) => {
    setTabs((prev) => {
      const next = [...prev]
      if (next[idx]) next[idx] = { ...next[idx], ...patch }
      return next
    })
  }, [])

  const setActiveTabInput = useCallback((val: string) => {
    updateTab(activeIdx, { input: val })
  }, [activeIdx, updateTab])

  const insertIntoInput = useCallback((text: string) => {
    const el = inputRef.current
    const start = el?.selectionStart ?? activeTab.input.length
    const end = el?.selectionEnd ?? activeTab.input.length
    setActiveTabInput(activeTab.input.slice(0, start) + text + activeTab.input.slice(end))
    requestAnimationFrame(() => {
      const pos = start + text.length
      inputRef.current?.setSelectionRange(pos, pos)
      inputRef.current?.focus()
    })
  }, [activeTab.input, setActiveTabInput])

  // Auto-grow the message textarea up to ~6 rows
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 168) + 'px'
  }, [activeTab.input, activeIdx])

  // Load conversation from history
  useEffect(() => {
    if (!loadConversationId || loadConversationId === loadedIdRef.current) return
    loadedIdRef.current = loadConversationId

    let cancelled = false
    window.sophia.data.getConversation(loadConversationId).then((conv) => {
      if (cancelled || !conv) return
      if (tabsRef.current.some((t) => t.conversationId === loadConversationId)) {
        const existingIdx = tabsRef.current.findIndex((t) => t.conversationId === loadConversationId)
        if (existingIdx >= 0) setActiveIdx(existingIdx)
        onConversationLoaded?.()
        return
      }
      window.sophia.data.listMessages(loadConversationId).then((msgs) => {
        if (cancelled) return
        const loaded: DisplayMessage[] = msgs.map((m) => ({
          id: m.id, role: m.role, content: m.content, createdAt: m.createdAt
        }))
        const newTab = makeTab(loadConversationId, conv.title)
        newTab.messages = loaded
        setTabs((prev) => [...prev, newTab])
        setActiveIdx(tabsRef.current.length)
        onConversationLoaded?.()
      })
    })
    return () => { cancelled = true }
  }, [loadConversationId, onConversationLoaded])

  // Reset loadedIdRef when no tabs have a conversation
  useEffect(() => {
    if (!tabs.some((t) => t.conversationId)) {
      loadedIdRef.current = null
    }
  }, [tabs])

  // Cancel stuck stream on companion change
  const prevCompanionIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = companion?.id ?? null
    if (prevCompanionIdRef.current !== null && prevCompanionIdRef.current !== id) {
      if (chatStream.state.isStreaming) chatStream.cancel()
      streamOwnerIdxRef.current = null
    }
    prevCompanionIdRef.current = id
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅监听伙伴 id 变化；chatStream 每次渲染都是新对象，不应作为依赖
  }, [companion?.id])

  // Focus input on mount/companion change
  useEffect(() => {
    if (companion) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- companion 对象每次渲染可能变化，仅按 id 聚焦一次
  }, [companion?.id, activeIdx])

  // Stop any TTS playback when leaving the classroom view.
  useEffect(() => stopTTS, [])

  // Track whether the user is pinned to the bottom of the message list.
  // Stops auto-scrolling once the user scrolls up to read earlier content.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setStickToBottom(nearBottom)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setMatchIndex(0)
    // Re-evaluate the scroll anchor based on the actual position, since
    // match navigation may have scrolled away from the bottom.
    const el = scrollRef.current
    if (el) {
      setStickToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
    }
  }, [])

  // Tab switching - update input/messages and reset scroll anchor
  useEffect(() => {
    setSendError(null)
    setStickToBottom(true)
  }, [activeIdx])

  // Close the in-conversation search with Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeSearch()
        setMathOpen(false)
        setShowShortcuts(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeSearch])

  // Close the math panel when clicking outside it
  useEffect(() => {
    if (!mathOpen) return
    const handler = (e: MouseEvent) => {
      if (mathRef.current && !mathRef.current.contains(e.target as Node)) {
        setMathOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [mathOpen])

  // Keyboard shortcuts: Ctrl+T new tab, Ctrl+Shift+W close tab,
  // Ctrl+Tab / Ctrl+Shift+Tab switch tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return

      // Shortcuts never fire while the user is typing in an input/textarea,
      // so they can't interrupt a message in progress (Ctrl+F and Ctrl+/
      // are still allowed — they are deliberate read-only actions).
      const target = e.target as HTMLElement | null
      const isTyping = !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (isTyping && e.key !== 'f' && e.key !== '/' && e.key !== 'a') return

      if (e.key === 't' && !e.shiftKey) {
        e.preventDefault()
        setTabs((prev) => [...prev, makeTab()])
        setActiveIdx(tabs.length)
        return
      }

      if (e.key === 'w' && e.shiftKey) {
        e.preventDefault()
        if (tabs.length <= 1) return
        const newIdx = activeIdx >= tabs.length - 1 ? activeIdx - 1 : activeIdx
        setTabs((prev) => prev.filter((_, i) => i !== activeIdx))
        setActiveIdx(Math.max(0, newIdx))
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        if (tabs.length <= 1) return
        if (e.shiftKey) {
          setActiveIdx(activeIdx === 0 ? tabs.length - 1 : activeIdx - 1)
        } else {
          setActiveIdx(activeIdx === tabs.length - 1 ? 0 : activeIdx + 1)
        }
      }

      if (e.key === 'f' && !e.shiftKey) {
        e.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => searchInputRef.current?.focus())
        return
      }

      if (e.key === '/' && !e.shiftKey) {
        e.preventDefault()
        setShowShortcuts((v) => !v)
        return
      }

      if (e.key === 'a' && e.shiftKey) {
        e.preventDefault()
        void handleAiAnswer()
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleAiAnswer 每次渲染重建，快捷键只需最新值，无需重挂监听
  }, [tabs, activeIdx])

  // Quick text templates: Alt+1..9 inserts a saved snippet at the caret
  // (1.0.7). Works while typing, unlike the Ctrl-based shortcuts above.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const n = parseInt(e.key, 10)
      if (n < 1 || n > MAX_TEXT_TEMPLATES) return
      const templates = loadTextTemplates()
      const snippet = templates[n - 1]
      if (!snippet) return
      e.preventDefault()
      insertIntoInput(snippet)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [insertIntoInput])

  // Close the template popover on outside click
  useEffect(() => {
    if (!templateOpen) return
    const handler = (e: MouseEvent) => {
      if (templateRef.current && !templateRef.current.contains(e.target as Node)) {
        setTemplateOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [templateOpen])

  const handleSend = async (options?: { input?: string; resend?: boolean }) => {
    // 发送防重：从按下发送到流式真正开始的间隙（构建 prompt 可能要一两秒）
    // 期间没有 isStreaming 标记，连按 Enter 会重复创建会话/发送多条。
    if (sendingRef.current) return
    sendingRef.current = true
    try {
      // 从 ref 读最新状态：重试/重新生成会在 await 后回调本次发送，
      // 渲染闭包里的 tabs 可能已经过期（会复活被删消息、重复 user 消息）。
      const tab = tabsRef.current[activeIdx]
      if (!tab) return
      const userMessage = options?.input ?? tab.input.trim()
      // resend：该用户消息已在库中（重试 / 重新生成），不能重复持久化、重复上屏。
      const isResend = options?.resend === true
      if (!userMessage || !companion) return
      if (userMessage.length > MAX_INPUT_LENGTH) {
        setSendError(`消息过长（上限 ${MAX_INPUT_LENGTH} 字），请分段发送`)
        return
      }

      if (chatStream.state.isStreaming) {
        // 其他标签正在回复：先确认，避免静默打断对方的回复。
        const ownerIdx = streamOwnerIdxRef.current
        if (ownerIdx !== null && ownerIdx !== activeIdx) {
          const ownerTab = tabsRef.current[ownerIdx]
          const ok = await window.sophia.dialog.confirm({
            message: `「${ownerTab?.title ?? '其他标签'}」正在回复中，发送将中断它的回复。确定继续吗？`,
            confirmLabel: '中断并发送'
          })
          if (!ok) return
        }
        await chatStream.cancel()
      }

      // 本次流式回复归属当前标签（用于流式内容显示定位）。
      streamOwnerIdxRef.current = activeIdx

      setSendError(null)

      let convId = tab.conversationId
      if (!convId) {
        if (isResend) {
          setSendError('对话状态异常，请重新开始课堂')
          return
        }
        // 默认课堂名：MM-DD 角色名（与课堂浏览器的显示规则一致）
        const now = new Date()
        const mm = String(now.getMonth() + 1).padStart(2, '0')
        const dd = String(now.getDate()).padStart(2, '0')
        const defaultTitle = `${mm}-${dd} ${companion.name}`
        try {
          const conv = await window.sophia.data.createConversation({
            companionId: companion.id,
            companionVersion: (companion as { version?: number }).version ?? undefined,
            textbookId: textbook?.id,
            title: defaultTitle
          })
          convId = conv.id
          updateTab(activeIdx, { conversationId: convId, title: defaultTitle })
        } catch {
          setSendError('创建对话失败，请重试')
          return
        }
      }

      if (isResend) {
        // 消息已在库中：只清理重试/重新生成状态，不重复入库、不重复上屏。
        updateTab(activeIdx, { retryMessage: null })
      } else {
        try {
          await window.sophia.data.sendMessage({
            conversationId: convId,
            content: userMessage,
            role: 'user',
          })
        } catch {
          try {
            const now = new Date()
            const mm = String(now.getMonth() + 1).padStart(2, '0')
            const dd = String(now.getDate()).padStart(2, '0')
            const defaultTitle = `${mm}-${dd} ${companion.name}`
            const conv = await window.sophia.data.createConversation({
              companionId: companion.id,
              companionVersion: (companion as { version?: number }).version ?? undefined,
              textbookId: textbook?.id,
              title: defaultTitle
            })
            convId = conv.id
            updateTab(activeIdx, { conversationId: convId, title: defaultTitle })
            await window.sophia.data.sendMessage({
              conversationId: convId,
              content: userMessage,
              role: 'user',
            })
          } catch {
            setSendError('发送消息失败，对话可能已被删除')
            return
          }
        }

        // 函数式更新：即使期间有其他状态变化也不会丢消息或重复 user 消息。
        setTabs((prev) => {
          const next = [...prev]
          const t = next[activeIdx]
          if (t) {
            t.messages = [
              ...t.messages,
              { id: `local-${Date.now()}`, role: 'user', content: userMessage, createdAt: new Date().toISOString() }
            ]
            t.input = ''
            t.retryMessage = null
          }
          return next
        })
      }
      setStickToBottom(true)

      let builtMessages
      try {
        const hideNarration = localStorage.getItem('sophia.hideNarration') === '1'
        builtMessages = await window.sophia.chat.getPromptMessages({
          conversationId: convId,
          companionId: companion.id,
          textbookId: textbook?.id ?? null,
          userMessage,
          classMode: tab.classMode,
          pace: tab.pace,
          hideNarration
        })
      } catch {
        setSendError('无法加载角色数据，请重新选择学习伙伴')
        return
      }

      const thinkingMode = loadThinkingMode()
      await chatStream.send(builtMessages, undefined, shouldUseThinking(userMessage, thinkingMode))

      const endPromise = chatStream.streamEnd
      if (endPromise) {
        // 回复归属发起标签（用户可能已在流式期间切换到其他标签）
        const targetIdx = streamOwnerIdxRef.current ?? activeIdx
        try {
          const { content, finishReason } = await endPromise
          const isPartial = finishReason.startsWith('error:')
          if (content && convId) {
            await window.sophia.data.sendMessage({
              conversationId: convId,
              content,
              role: 'assistant',
              })
          }
          if (content) {
            setTabs((prev) => {
              const next = [...prev]
              const t = next[targetIdx]
              if (t) t.messages = [...t.messages, { id: `assistant-${Date.now()}`, role: 'assistant', content, createdAt: new Date().toISOString() }]
              return next
            })
          }
          if (isPartial) {
            setTabs((prev) => {
              const next = [...prev]
              const t = next[targetIdx]
              if (t) t.retryMessage = { input: userMessage, convId: convId! }
              return next
            })
            setSendError('回复被中断，已保存部分内容。可重试获取完整回复。')
          }
        } catch {
          setTabs((prev) => {
            const next = [...prev]
            const t = next[targetIdx]
            if (t) t.retryMessage = { input: userMessage, convId: convId! }
            return next
          })
        } finally {
          streamOwnerIdxRef.current = null
        }
      }

      // 流式结束后恢复输入框焦点（rAF 等 React 完成状态刷新，避免
      // 在禁用态切换的间隙聚焦失败）
      requestAnimationFrame(() => inputRef.current?.focus())
    } catch (e) {
      setSendError(e instanceof Error ? e.message : '发送失败，请重试')
    } finally {
      sendingRef.current = false
    }
  }

  const handleEndClass = async () => {
    if (!activeTab.conversationId) return
    const ok = await window.sophia.dialog.confirm({
      message: '确定下课吗？将生成课后总结、记忆卡片和学习日记。输入框中尚未发送的文字会保留。',
      confirmLabel: '下课',
      cancelLabel: '取消'
    })
    if (!ok) return
    setIsLoading(true)
    try {
      const result = await window.sophia.data.endConversation(
        activeTab.conversationId,
        activeTab.classMode
      )
      if (result.success) {
        updateTab(activeIdx, {
          endResult: {
            artifacts: result.artifacts,
            farewell: result.farewell,
            failures: result.failures?.length ? result.failures : undefined,
            conversationId: activeTab.conversationId ?? undefined,
            pending: result.pending
          },
          conversationId: null,
          messages: []
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleRedoArtifacts = async () => {
    const convId = activeTab.endResult?.conversationId
    const failures = activeTab.endResult?.failures
    if (!convId || !failures || failures.length === 0 || redoing) return
    setRedoing(true)
    try {
      const result = await window.sophia.data.redoArtifacts(convId, failures)
      if (result.success) {
        updateTab(activeIdx, {
          endResult: {
            ...activeTab.endResult!,
            failures: result.failures.length > 0 ? result.failures : undefined,
            artifacts: (activeTab.endResult?.artifacts ?? 0) + result.artifacts
          }
        })
      }
    } catch {
      // keep the failure list so the user can retry
    } finally {
      setRedoing(false)
    }
  }

  const handleRename = () => {
    if (!activeTab.conversationId) return
    setEditingTitle(true)
    setTitleInput(activeTab.title)
  }

  const handleContinueLearning = () => {
    const newTab = makeTab()
    setTabs((prev) => [...prev, newTab])
    setActiveIdx(tabsRef.current.length)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleReviewNewCards = () => {
    const convId = activeTab.endResult?.conversationId
    if (!convId) return
    useAppStore.getState().setFlashcardScope({
      conversationId: convId,
      title: activeTab.title
    })
    useAppStore.getState().setView('flashcards')
  }

  const handleScreenshot = async () => {
    const result = await window.sophia.dialog.saveFile({
      defaultPath: `Sophia_课堂_${new Date().toISOString().slice(0, 10)}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return
    await window.sophia.data.captureScreenshot(result.filePath)
  }

  // 课堂内嵌教材阅读分栏：拖动分隔条调整宽度
  const handleReaderResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    readerResizeStart.current = { x: e.clientX, w: readerWidth }
    const onMove = (ev: MouseEvent) => {
      const s = readerResizeStart.current
      if (!s) return
      // 分隔条右侧是阅读器。分隔条位于聊天列与阅读器之间（flex 布局）：
      // 宽度增大时分隔条会向左移动，所以要让分隔条跟随鼠标（向右拖 =
      // 阅读器变窄），宽度变化必须与鼠标位移相反。
      // 上限随视口变化：阅读器最宽 = 窗口宽 − 聊天区最小宽度。
      const maxW = Math.max(280, window.innerWidth - 360)
      const next = Math.min(maxW, Math.max(280, s.w + (s.x - ev.clientX)))
      readerWidthRef.current = next
      setReaderWidth(next)
    }
    const onUp = () => {
      readerResizeStart.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      try {
        localStorage.setItem('sophia.classroomReaderWidth', String(readerWidthRef.current))
      } catch { /* best-effort */ }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleAiAnswer = async () => {
    if (aiAnswering || !companion) return
    const tab = activeTab
    const recent = tab.messages.slice(-8)
    const lastAssistant = [...recent].reverse().find((m) => m.role === 'assistant')
    const question = lastAssistant?.content || activeTab.input.trim() || '（当前没有明确的问题）'
    const history = recent
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role === 'user' ? '你' : companion.name}: ${m.content}`)
      .join('\n\n')

    setAiAnswering(true)
    try {
      const { content } = await window.sophia.data.composeAiAnswer(question, history)
      if (content) {
        const cur = activeTab.input
        const combined = cur.trim() ? `${cur.trimEnd()}\n${content}` : content
        setActiveTabInput(combined.slice(0, MAX_INPUT_LENGTH))
        inputRef.current?.focus()
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'AI 代答失败，请重试')
    } finally {
      setAiAnswering(false)
    }
  }

  const handleSaveTitle = async () => {
    if (!activeTab.conversationId || !titleInput.trim()) {
      setEditingTitle(false)
      return
    }
    await window.sophia.data.updateTitle(activeTab.conversationId, titleInput.trim())
    updateTab(activeIdx, { title: titleInput.trim() })
    setEditingTitle(false)
  }

  const handleEditMessage = useCallback(async (messageId: string, content: string) => {
    const conversationId = tabsRef.current[activeIdx]?.conversationId
    if (!conversationId) return
    await window.sophia.data.updateMessage(conversationId, messageId, content)
    setTabs((prev) => {
      const next = [...prev]
      const t = next[activeIdx]
      if (t) {
        t.messages = t.messages.map((m) => m.id === messageId ? { ...m, content } : m)
      }
      return next
    })
  }, [activeIdx])

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    const conversationId = tabsRef.current[activeIdx]?.conversationId
    if (!conversationId) return
    await window.sophia.data.deleteMessage(conversationId, messageId)
    setTabs((prev) => {
      const next = [...prev]
      const t = next[activeIdx]
      if (t) t.messages = t.messages.filter((m) => m.id !== messageId)
      return next
    })
  }, [activeIdx])

  const handleRewind = useCallback(async (messageId: string) => {
    const conversationId = tabsRef.current[activeIdx]?.conversationId
    if (!conversationId) return
    const ok = await window.sophia.dialog.confirm({
      message: '将删除这条消息之后的所有对话并从这一点继续，确定吗？',
      confirmLabel: '回退到这里'
    })
    if (!ok) return
    const truncated = await window.sophia.data.truncateConversation(conversationId, messageId)
    if (truncated) {
      setTabs((prev) => {
        const next = [...prev]
        const t = next[activeIdx]
        if (t) {
          const idx = t.messages.findIndex((m) => m.id === messageId)
          if (idx >= 0) t.messages = t.messages.slice(0, idx + 1)
        }
        return next
      })
      setStickToBottom(true)
    }
  }, [activeIdx])

  // Latest-value ref so the memoized handlers below stay identity-stable
  // across stream ticks (the chatStream object changes on every token).
  const handleSendRef = useRef(handleSend)
  useEffect(() => {
    handleSendRef.current = handleSend
  })

  const handleRegenerate = useCallback(async (messageId: string) => {
    const tab = tabsRef.current[activeIdx]
    const msgs = tab?.messages ?? []
    const msgIdx = msgs.findIndex((m) => m.id === messageId)
    if (msgIdx < 0) return

    // Drop this assistant message and everything after it (both UI and DB),
    // then let the model answer the same user turn again.
    const newMessages = msgs.slice(0, msgIdx)
    const lastUserMsg = [...newMessages].reverse().find((m) => m.role === 'user')
    if (!lastUserMsg) return

    setTabs((prev) => {
      const next = [...prev]
      const t = next[activeIdx]
      if (t) t.messages = newMessages
      return next
    })

    if (tab?.conversationId) {
      try {
        // Truncate through the user message: removes the assistant reply and
        // any later messages that the UI just dropped (deleteMessage alone
        // would leave them orphaned in the store).
        await window.sophia.data.truncateConversation(tab.conversationId, lastUserMsg.id)
      } catch {
        // The local list is already consistent; a failed truncate must not
        // block the regeneration attempt.
      }
    }

    // resend: the user message is already persisted — handleSend must not
    // persist it again nor append it to the UI list a second time.
    await handleSendRef.current({ input: lastUserMsg.content, resend: true })
  }, [activeIdx])

  const handleSendFromContent = async (content: string) => {
    await handleSend({ input: content })
  }

  const handleNewTab = () => {
    setTabs((prev) => [...prev, makeTab()])
    setActiveIdx(tabs.length)
  }

  const handleCloseTab = (idx: number) => {
    if (tabs.length <= 1) return
    setTabs((prev) => prev.filter((_, i) => i !== idx))
    if (activeIdx >= idx) {
      setActiveIdx(Math.max(0, activeIdx - 1))
    }
  }

  // Build display messages including streaming
  // 流式内容是全局单例状态，只显示在发起发送的标签上，避免切换标签时串位。
  const streamingHere =
    chatStream.state.isStreaming &&
    streamOwnerIdxRef.current === activeIdx
  const allMessages = useMemo(() => {
    const out = [...activeTab.messages]
    if (streamingHere && chatStream.state.assistantContent) {
      out.push({
        id: 'streaming',
        role: 'assistant',
        content: chatStream.state.assistantContent
      })
    }
    return out
  }, [activeTab.messages, streamingHere, chatStream.state.assistantContent])

  // ---- verify_grounding 轻量校验（里程碑 2）：知识性提问的回复未引用教材出处时提示 ----
  const groundingFlagged = useMemo(() => {
    if (!textbook) return new Set<string>()
    const flagged = new Set<string>()
    for (let i = 1; i < allMessages.length; i++) {
      const prev = allMessages[i - 1]
      const cur = allMessages[i]
      if (prev.role === 'user' && cur.role === 'assistant' &&
          isKnowledgeQuestion(prev.content) && !hasTextbookCitation(cur.content)) {
        flagged.add(cur.id)
      }
    }
    return flagged
  }, [allMessages, textbook])

  // ---- In-conversation search (Ctrl+F) ----
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    const matches: number[] = []
    allMessages.forEach((m, i) => {
      if (m.content.toLowerCase().includes(q)) matches.push(i)
    })
    return matches
  }, [allMessages, searchQuery])

  const goToMatch = useCallback((dir: 1 | -1) => {
    if (searchMatches.length === 0) return
    setMatchIndex((prev) => {
      const clamped = Math.min(prev, searchMatches.length - 1)
      return (clamped + dir + searchMatches.length) % searchMatches.length
    })
  }, [searchMatches.length])

  // Reset the current match when the query changes
  useEffect(() => {
    setMatchIndex(0)
  }, [searchQuery])

  // ---- Virtualized message rows ----
  const rows = useMemo<MessageRow[]>(() => {
    const q = searchQuery.trim().toLowerCase()
    const currentIdx = searchMatches.length > 0 ? Math.min(matchIndex, searchMatches.length - 1) : -1
    const out: MessageRow[] = allMessages.map((msg, idx) => ({
      kind: 'message',
      key: msg.id,
      msg,
      showThinking:
        idx === allMessages.length - 1 &&
        msg.role === 'assistant' &&
        streamingHere &&
        chatStream.state.reasoningContent.length > 0,
      highlight:
        q.length > 0 && msg.content.toLowerCase().includes(q)
          ? searchMatches[currentIdx] === idx
            ? 'current'
            : 'match'
          : 'none'
    }))
    if (chatStream.state.error || sendError) {
      out.push({ kind: 'error', key: 'row-error' })
    }
    if (activeTab.endResult) {
      out.push({ kind: 'end', key: 'row-end' })
    }
    return out
  }, [
    allMessages,
    searchQuery,
    searchMatches,
    matchIndex,
    streamingHere,
    chatStream.state.reasoningContent,
    chatStream.state.error,
    sendError,
    activeTab.endResult
  ])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 200,
    overscan: 10,
    getItemKey: (index) => rows[index].key
  })

  // 当前虚拟化总高度（估计 + 已测量）。行高测量更新时该值变化，
  // 用于在贴底状态下跟随内容高度变化重新钉底。
  const totalSize = virtualizer.getTotalSize()

  // Auto-scroll to the newest message while pinned to the bottom.
  // 直接钉在真实底部（scrollHeight），不依赖虚拟化的估计总高度——
  // 用 scrollToOffset(getTotalSize()) 时，未测量行按 estimateSize 估算，
  // 长回复会低估总高度，把视口"弹回"到比真实底部高的位置。
  useEffect(() => {
    if (!stickToBottom || rows.length === 0) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [activeTab.messages, chatStream.state.assistantContent, stickToBottom, totalSize, rows.length])

  // Scroll the current search match into view.
  useEffect(() => {
    if (searchMatches.length === 0) return
    const target = searchMatches[Math.min(matchIndex, searchMatches.length - 1)]
    setStickToBottom(false)
    virtualizer.scrollToIndex(target, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在匹配项变化时跳转；virtualizer 实例随 rows 变化，加入会打断贴底滚动
  }, [matchIndex, searchMatches])

  // Pin to the bottom when a new stream starts.
  const prevStreamingRef = useRef(false)
  useEffect(() => {
    if (chatStream.state.isStreaming && !prevStreamingRef.current) {
      setStickToBottom(true)
    }
    prevStreamingRef.current = chatStream.state.isStreaming
  }, [chatStream.state.isStreaming])

  // Background artifact generation results — update the matching end card
  // when the main process finishes generating (end of class no longer blocks).
  useEffect(() => {
    return window.sophia.data.onArtifactsGenerated((payload) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.endResult?.conversationId !== payload.conversationId) return tab
          return {
            ...tab,
            endResult: {
              ...tab.endResult,
              pending: false,
              generationError: payload.error,
              artifacts: payload.artifacts,
              farewell: payload.farewell,
              failures: payload.failures.length > 0 ? payload.failures : undefined
            }
          }
        })
      )
    })
  }, [])

  if (!companion) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-text-muted">
          <p className="text-lg">请先选择一位学习伙伴</p>
          <p className="mt-2 text-sm">点击顶部菜单栏的「角色」选择，或点击「课堂」下拉菜单新建</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b border-surface-border bg-bg-surface px-2 pt-1">
        <div className="flex-1 flex items-center overflow-x-auto gap-0.5">
          {tabs.map((tab, idx) => (
            <div
              key={tab.id}
              onClick={() => setActiveIdx(idx)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-t cursor-pointer select-none whitespace-nowrap max-w-[160px] ${
                idx === activeIdx
                  ? 'bg-bg-deep text-text-primary border border-b-0 border-surface-border -mb-px'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-elevated'
              }`}
            >
              <span className="truncate">{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleCloseTab(idx) }}
                  className="flex-shrink-0 ml-1 w-4 h-4 flex items-center justify-center rounded hover:bg-red-900/30 hover:text-red-400"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={handleNewTab}
          className="flex-shrink-0 px-2 py-1.5 text-xs text-text-muted hover:text-text-secondary hover:bg-bg-elevated rounded"
          title="新建对话"
        >
          +
        </button>
      </div>

      {/* Header */}
      <div className="border-b border-surface-border bg-bg-surface px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <h2 className="font-semibold truncate">{companion.name}</h2>
              <p className="text-xs text-text-muted truncate">{companion.identity}</p>
            </div>
            {activeTab.conversationId && (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-text-muted text-xs">|</span>
                {editingTitle ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={titleInput}
                      onChange={(e) => setTitleInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSaveTitle()
                        if (e.key === 'Escape') setEditingTitle(false)
                      }}
                      onBlur={handleSaveTitle}
                      className="w-40 rounded border border-accent-border bg-bg-deep px-2 py-0.5 text-xs text-text-primary focus:outline-none"
                      autoFocus
                    />
                  </div>
                ) : (
                  <button
                    onClick={handleRename}
                    className="text-xs text-text-muted hover:text-text-secondary truncate max-w-[200px]"
                    title="点击重命名"
                  >
                    {activeTab.title} ✏️
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div
              className="flex overflow-hidden rounded-full border border-surface-border-strong text-xs"
              title="教学节奏：慢速不跳过独立知识点；快速略过已掌握内容"
            >
              {(['slow', 'normal', 'fast'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => updateTab(activeIdx, { pace: p })}
                  className={`px-2 py-1 transition-colors ${
                    activeTab.pace === p
                      ? 'bg-accent text-white'
                      : 'text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
                  }`}
                >
                  {p === 'slow' ? '慢' : p === 'normal' ? '标准' : '快'}
                </button>
              ))}
            </div>
            <button
              onClick={() => updateTab(activeIdx, {
                classMode: activeTab.classMode === 'feynman' ? 'standard' : 'feynman'
              })}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                activeTab.classMode === 'feynman'
                  ? 'border-accent text-accent hover:bg-accent-subtle'
                  : 'border-surface-border-strong text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
              }`}
              title="切换课堂模式：标准苏格拉底课堂 / 费曼回讲（学习者向学徒讲解，检验理解）"
            >
              {activeTab.classMode === 'feynman' ? '🗣 费曼回讲' : '🎓 标准课堂'}
            </button>
            {textbook?.originalFile && (
              <button
                onClick={() => setReaderOpen((v) => !v)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  readerOpen
                    ? 'border-accent text-accent hover:bg-accent-subtle'
                    : 'border-surface-border-strong text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
                }`}
                title="并排打开教材阅读（拖动分隔条调整宽度）"
              >
                📖 {readerOpen ? '关闭阅读' : '教材阅读'}
              </button>
            )}
            <button
              onClick={() => void handleScreenshot()}
              className="rounded-full border border-surface-border-strong px-3 py-1 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
              title="截图当前课堂窗口并保存为图片"
            >
              📷 截图
            </button>
            {textbook && (
              <span className="rounded-full bg-bg-elevated px-3 py-1 text-xs">
                📖 {textbook.title}
              </span>
            )}
            {chatStream.state.isStreaming && (
              <span className="text-xs text-accent animate-pulse">
                {chatStream.state.reasoningContent.length > 0 ? '正在推理…' : '正在组织回答…'}
              </span>
            )}
            {dailyGoal > 0 && (
              <div
                className="flex items-center gap-1.5"
                title={`今日已学习 ${todayMinutes}/${dailyGoal} 分钟`}
              >
                <svg width="26" height="26" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--bg-elevated)" strokeWidth="4" />
                  <circle
                    cx="18" cy="18" r="15.5" fill="none" stroke="var(--accent)" strokeWidth="4"
                    strokeLinecap="round" pathLength={100}
                    strokeDasharray={`${Math.min(100, Math.round((todayMinutes / dailyGoal) * 100))} 100`}
                    transform="rotate(-90 18 18)"
                  />
                </svg>
                <span className="text-xs tabular-nums text-text-muted">{todayMinutes}/{dailyGoal}m</span>
              </div>
            )}
            {activeTab.conversationId && (
              <button
                onClick={handleEndClass}
                disabled={isLoading}
                className="rounded border border-amber-700/60 px-3 py-1 text-xs text-amber-700 hover:bg-amber-900/30 disabled:opacity-50"
              >
                {isLoading ? '处理中...' : '下课'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* In-conversation search (Ctrl+F) */}
      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-surface-border bg-bg-surface px-4 py-1.5">
          <span className="text-xs text-text-muted">🔍</span>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                goToMatch(e.shiftKey ? -1 : 1)
              }
              if (e.key === 'Escape') {
                closeSearch()
              }
            }}
            placeholder="搜索本对话..."
            className="w-44 rounded border border-surface-border-strong bg-bg-deep px-2 py-1 text-xs text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
          />
          <span className="w-14 text-right text-xs tabular-nums text-text-muted">
            {searchMatches.length > 0
              ? `${Math.min(matchIndex, searchMatches.length - 1) + 1}/${searchMatches.length}`
              : '0/0'}
          </span>
          <button
            onClick={() => goToMatch(-1)}
            disabled={searchMatches.length === 0}
            className="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-secondary disabled:opacity-40"
            title="上一个 (Shift+Enter)"
          >
            ↑
          </button>
          <button
            onClick={() => goToMatch(1)}
            disabled={searchMatches.length === 0}
            className="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-secondary disabled:opacity-40"
            title="下一个 (Enter)"
          >
            ↓
          </button>
          <button
            onClick={closeSearch}
            className="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
            title="关闭搜索 (Esc)"
          >
            ✕
          </button>
        </div>
      )}

      {/* 左右分栏：聊天（左） + 教材阅读（右，可拖宽） */}
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0">
      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto p-6">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-text-muted">
              开始和 <span className="text-text-secondary">{companion.name}</span> 对话吧。
               <br />
              试着提出一个你想探讨的问题。
            </p>
          </div>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index]
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  className="pb-4"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vi.start}px)`
                  }}
                >
                  {row.kind === 'message' && (
                    <>
                      {row.showThinking && (
                        <details className="mb-2 rounded border border-surface-border bg-bg-surface/60 px-3 py-2">
                          <summary className="cursor-pointer select-none text-xs text-text-muted hover:text-text-secondary">
                            🧠 思考过程 {chatStream.state.isStreaming && <span className="text-accent animate-pulse">(进行中...)</span>}
                          </summary>
                          <ThinkingBlock content={chatStream.state.reasoningContent} />
                        </details>
                      )}
                      <ChatMessage
                        id={row.msg.id}
                        role={row.msg.role}
                        content={row.msg.content}
                        createdAt={row.msg.createdAt}
                        showActions={!chatStream.state.isStreaming && row.msg.role !== 'system'}
                        highlight={row.highlight}
                        textbookId={textbook?.id ?? null}
                        showGroundingNotice={groundingFlagged.has(row.msg.id)}
                        onRewind={
                          !chatStream.state.isStreaming &&
                          row.msg.role !== 'system' &&
                          vi.index < allMessages.length - 1
                            ? handleRewind
                            : undefined
                        }
                        onEdit={handleEditMessage}
                        onDelete={handleDeleteMessage}
                        onRegenerate={handleRegenerate}
                      />
                    </>
                  )}
                  {row.kind === 'error' && (
                    <div className="rounded border border-red-700/50 bg-red-900/20 px-4 py-3 text-sm text-red-500">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">发送失败</p>
                          <p className="mt-1 text-xs text-red-500/80">{sendError ?? chatStream.state.error?.message}</p>
                        </div>
                        {activeTab.retryMessage && (
                          <button
                            onClick={() => handleSend({ input: activeTab.retryMessage!.input, resend: true })}
                            className="rounded bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-600"
                          >
                            重试
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {row.kind === 'end' && activeTab.endResult && (
                    <div className="rounded border border-surface-border bg-bg-elevated px-4 py-3 text-sm text-text-primary">
                      <p className="font-medium">课程已结束</p>
                      {activeTab.endResult.pending && (
                        <p className="mt-2 text-xs text-text-secondary animate-pulse">
                          学习摘要后台生成中，完成后自动显示…
                        </p>
                      )}
                      {activeTab.endResult.generationError && (
                        <p className="mt-2 text-xs text-red-500">
                          后台生成失败：{activeTab.endResult.generationError}
                        </p>
                      )}
                      {activeTab.endResult.farewell && (
                        <p className="mt-2 text-sm text-text-secondary italic">{activeTab.endResult.farewell}</p>
                      )}
                      {!activeTab.endResult.pending && (
                        <>
                          <p className="mt-1 text-xs text-text-muted">
                            已自动生成 {activeTab.endResult.artifacts} 个学习摘要（课堂总结、记忆卡片、学习日记等）
                          </p>
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              onClick={handleReviewNewCards}
                              className="rounded bg-green-800 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                              title="复习本节课新生成的记忆卡片，不足时自动补充以前的到期卡片"
                            >
                              复习本节新卡
                            </button>
                            <button
                              onClick={handleContinueLearning}
                              className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
                              title="同一本教材、同一位伙伴开一节新课堂"
                            >
                              继续学习
                            </button>
                          </div>
                        </>
                      )}
            {activeTab.endResult.failures && activeTab.endResult.failures.length > 0 && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2">
                <p className="text-xs text-text-secondary">
                  有 {activeTab.endResult.failures.length} 项学习摘要生成失败（可能是网络中断），可只补齐缺失项。
                </p>
                <button
                  onClick={handleRedoArtifacts}
                  disabled={redoing}
                  className="flex-shrink-0 rounded bg-amber-700 px-3 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {redoing ? '补齐中...' : '补齐缺失产物'}
                </button>
              </div>
            )}
          </div>
        )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-surface-border bg-bg-surface p-4">
        {/* 快捷课堂操作（里程碑 2）：预置教学指令，一键发送 */}
        <div className="mb-2 flex flex-wrap gap-1">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              onClick={() => handleSendFromContent(a.prompt)}
              disabled={chatStream.state.isStreaming || !companion}
              className="rounded-full border border-surface-border-strong px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:border-accent-border hover:text-accent-hover disabled:opacity-40"
              title={a.title}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div ref={mathRef} className="relative flex gap-3">
          {mathOpen && (
            <div className="absolute bottom-full left-0 z-20 mb-2 w-80 rounded-lg border border-surface-border bg-bg-surface p-3 shadow-lg">
              <div className="mb-2 flex flex-wrap gap-1">
                {MATH_SYMBOL_GROUPS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setMathTab(g.id)}
                    className={`rounded px-2 py-0.5 text-xs transition-colors ${
                      mathTab === g.id
                        ? 'bg-accent text-white'
                        : 'text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-8 gap-1">
                {(MATH_SYMBOL_GROUPS.find((g) => g.id === mathTab) ?? MATH_SYMBOL_GROUPS[0]).items.map((s) => (
                  <button
                    key={s}
                    onClick={() => insertIntoInput(s)}
                    className="overflow-hidden rounded border border-surface-border-strong px-1 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated"
                    title={s}
                  >
                    {s.length > 6 ? '模板' : s}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-text-muted">
                点击插入到输入框；用 $...$ 包裹即可渲染为公式
              </p>
            </div>
          )}
          <button
            onClick={() => { setMathOpen((v) => !v); setMathTab('greek') }}
            className={`rounded border px-3 py-2 text-sm transition-colors ${
              mathOpen
                ? 'border-accent text-accent'
                : 'border-surface-border-strong text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
            }`}
            title="插入数学符号 / 公式 (Σ)"
          >
            Σ
          </button>
          <div ref={templateRef} className="relative">
            {templateOpen && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-80 rounded-lg border border-surface-border bg-bg-surface p-3 shadow-lg">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-text-muted">常用文本模板（Alt+1..9 插入）</span>
                  <button
                    onClick={() => setTemplateOpen(false)}
                    className="rounded p-1 text-xs text-text-muted hover:bg-bg-elevated"
                  >
                    x
                  </button>
                </div>
                {loadTextTemplates().length === 0 ? (
                  <p className="text-xs text-text-muted">
                    还没有模板。在「设置 → 常用文本模板」中添加，最多 {MAX_TEXT_TEMPLATES} 条。
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {loadTextTemplates().map((t, i) => (
                      <li key={i}>
                        <button
                          onClick={() => { insertIntoInput(t); setTemplateOpen(false) }}
                          className="w-full truncate rounded px-2 py-1 text-left text-xs text-text-secondary hover:bg-bg-elevated"
                          title={t}
                        >
                          <kbd className="mr-1.5 rounded border border-surface-border-strong bg-bg-elevated px-1 py-0.5 font-mono text-[10px] text-text-muted">
                            Alt+{i + 1}
                          </kbd>
                          {t}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <button
              onClick={() => { setTemplateOpen((v) => !v); setMathOpen(false) }}
              className={`rounded border px-3 py-2 text-sm transition-colors ${
                templateOpen
                  ? 'border-accent text-accent'
                  : 'border-surface-border-strong text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
              }`}
              title="插入常用文本模板"
            >
              ☰
            </button>
          </div>
          <button
            onClick={() => void handleAiAnswer()}
            disabled={aiAnswering || !companion}
            className="rounded border border-surface-border-strong px-3 py-2 text-sm text-text-muted hover:bg-bg-elevated hover:text-text-secondary disabled:opacity-50"
            title="AI 代答：让伙伴示范起草一段回复（Ctrl+Shift+A）"
          >
            {aiAnswering ? '起草中...' : 'AI 代答'}
          </button>
          <textarea
            ref={inputRef}
            value={activeTab.input}
            onChange={(e) => {
              const { action, stripped } = detectVoiceTrigger(e.target.value, loadVoiceTriggers())
              if (action === 'send') {
                updateTab(activeIdx, { input: stripped })
                if (stripped.trim()) {
                  void handleSend({ input: stripped })
                }
              } else if (action === 'clear') {
                updateTab(activeIdx, { input: '' })
              } else {
                setActiveTabInput(e.target.value)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={1}
            placeholder="输入你的问题... (Enter 发送，Shift+Enter 换行)"
            className="flex-1 resize-none overflow-y-auto rounded border border-surface-border-strong bg-bg-deep px-4 py-2 text-sm leading-relaxed text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
          />
          {chatStream.state.isStreaming ? (
            <button
              onClick={() => chatStream.cancel()}
              className="rounded border border-red-700 px-4 py-2 text-sm text-red-400 hover:bg-red-900/30"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!activeTab.input.trim() || sendingRef.current}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {sendingRef.current ? '发送中...' : '发送'}
            </button>
          )}
        </div>
      </div>
        </div>{/* 聊天列（消息 + 输入）结束 */}

        {/* 教材阅读分栏（可拖拽宽度） */}
        {readerOpen && textbook?.originalFile && (
          <>
            <div
              onMouseDown={handleReaderResizeStart}
              className="w-1.5 flex-shrink-0 cursor-col-resize bg-bg-surface transition-colors hover:bg-accent/60"
              title="拖动调整阅读宽度"
            />
            <div
              className="flex min-w-0 flex-shrink-0 flex-col border-l border-surface-border bg-bg-deep"
              style={{ width: readerWidth }}
            >
              <Suspense fallback={<div className="flex flex-1 items-center justify-center text-xs text-text-muted">阅读器加载中...</div>}>
                {textbook.format === 'epub' ? (
                  <EpubReaderView
                    textbookId={textbook.id}
                    title={textbook.title}
                    onClose={() => setReaderOpen(false)}
                    embedded
                  />
                ) : (
                  <PdfReaderView
                    textbookId={textbook.id}
                    title={textbook.title}
                    onClose={() => setReaderOpen(false)}
                    embedded
                  />
                )}
              </Suspense>
            </div>
          </>
        )}
      </div>{/* 左右分栏容器结束 */}

      {/* Shortcut cheat sheet */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="w-80 rounded-xl border border-surface-border bg-bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-base font-semibold">键盘快捷键</h3>
            <div className="space-y-2.5 text-sm">
              {[
                ['Ctrl + T', '新建标签页'],
                ['Ctrl + Shift + W', '关闭当前标签页'],
                ['Ctrl + Tab', '下一个标签页'],
                ['Ctrl + Shift + Tab', '上一个标签页'],
                ['Ctrl + F', '在当前对话中搜索'],
                ['Ctrl + /', '显示 / 隐藏快捷键'],
                ['Ctrl + Shift + A', 'AI 代答（示范回复）'],
                ['Alt + 1..9', '插入常用文本模板']
              ].map(([keys, desc]) => (
                <div key={keys} className="flex items-center justify-between gap-3">
                  <kbd className="rounded border border-surface-border-strong bg-bg-elevated px-2 py-0.5 font-mono text-xs text-text-secondary">
                    {keys}
                  </kbd>
                  <span className="text-xs text-text-muted">{desc}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowShortcuts(false)}
              className="mt-5 w-full rounded bg-accent py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              关闭 (Esc)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
