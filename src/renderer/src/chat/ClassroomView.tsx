import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
import { useChatStream } from './useChatStream'
import { useReaderSplit } from './useReaderSplit'
import { useConversationSearch, findMessageMatches } from './useConversationSearch'
import { stopTTS } from '../hooks/useTTS'
import { loadTabs, saveTabs, serializeTabs } from '../../../shared/tab-persistence'
import { useAppStore } from '../stores/useAppStore'
import { loadTextTemplates, MAX_TEXT_TEMPLATES } from '../../../shared/text-templates'
import { useTodayStudyMinutes } from '../hooks/useTodayStudyMinutes'
import { isKnowledgeQuestion, hasTextbookCitation } from '../../../shared/grounding'
import { useClassroomSend } from './useClassroomSend'
import { useChatStreamTick } from './chat-stream-store'
import { ClassroomHeader } from './ClassroomHeader'
import { ConversationSearchBar } from './ConversationSearchBar'
import { ClassroomTabBar } from './ClassroomTabBar'
import { ClassroomComposer } from './ClassroomComposer'
import { ShortcutSheet } from './ShortcutSheet'
import { MessageList, type MessageRow } from './MessageList'
import { useMessageListScroll } from './useMessageListScroll'
import { MAX_INPUT_LENGTH, type DisplayMessage, type TabState } from './types'

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
  // Re-render (frame-coalesced) while the stream state changes; App no longer
  // subscribes, so this is the only place tokens trigger a render pass.
  useChatStreamTick()
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
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const loadedIdRef = useRef<string | null>(null)
  // In-conversation search (Ctrl+F)
  const search = useConversationSearch()
  const {
    searchOpen,
    searchQuery,
    setSearchQuery,
    matchIndex,
    searchInputRef,
    closeSearch
  } = search
  // Quick text templates (1.0.7): Alt+1..9 inserts a saved snippet.
  const [templateOpen, setTemplateOpen] = useState(false)
  const templateRef = useRef<HTMLDivElement>(null)
  // AI 代答 (3.2.0 Ctrl+Shift+A): draft a learner reply to paste/send.
  const [aiAnswering, setAiAnswering] = useState(false)
  // 课堂内嵌教材阅读分栏（左右并排，宽度可拖拽调整）
  const { readerOpen, setReaderOpen, readerWidth, handleReaderResizeStart } = useReaderSplit()
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
  // Scroll behaviour (stick-to-bottom / virtualization) lives in
  // useMessageListScroll — see the call below, after `rows` is built.
  // Mirror of `tabs` for async callbacks — the render-closure `tabs` goes
  // stale inside .then() chains that run after later re-renders.
  const tabsRef = useRef(tabs)
  // 当前流式回复归属的标签索引。流式内容是全局单例状态，
  // 必须只显示在发起发送的标签上，避免切换标签时内容"串位"。
  const streamOwnerIdxRef = useRef<number | null>(null)
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  // Mirror for event handlers that are registered once (keyboard shortcuts).
  const activeIdxRef = useRef(activeIdx)
  useEffect(() => { activeIdxRef.current = activeIdx }, [activeIdx])
  // Latest-value ref for the Ctrl+Shift+A handler (registered once, no
  // re-subscription on every keystroke).
  const handleAiAnswerRef = useRef<(() => Promise<void>) | null>(null)

  // Persist the tab strip (title / conversationId / draft) across restarts.
  // Debounced: the draft lives inside `tabs`, so a synchronous localStorage
  // write on every keystroke would be the app's hottest write path.
  useEffect(() => {
    const timer = setTimeout(() => {
      saveTabs(localStorage, serializeTabs(tabsRef.current, activeIdxRef.current))
    }, 400)
    return () => clearTimeout(timer)
  }, [tabs, activeIdx])

  // Flush the latest state on unmount (view switch / app quit) so the
  // debounce can never lose the last keystrokes.
  useEffect(() => () => {
    saveTabs(localStorage, serializeTabs(tabsRef.current, activeIdxRef.current))
  }, [])

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
    void window.sophia.data.getConversation(loadConversationId).then((conv) => {
      if (cancelled || !conv) return
      if (tabsRef.current.some((t) => t.conversationId === loadConversationId)) {
        const existingIdx = tabsRef.current.findIndex((t) => t.conversationId === loadConversationId)
        if (existingIdx >= 0) setActiveIdx(existingIdx)
        onConversationLoaded?.()
        return
      }
      void window.sophia.data.listMessages(loadConversationId).then((msgs) => {
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
      if (chatStream.state.isStreaming) void chatStream.cancel()
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

  // Tab switching clears the send error; the scroll anchor reset for a new
  // tab lives in useMessageListScroll (it watches activeIdx).
  useEffect(() => {
    setSendError(null)
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
  // Ctrl+Tab / Ctrl+Shift+Tab switch tabs.
  // Registered ONCE — state is read through refs so typing in the composer
  // (which updates `tabs` on every keystroke) never re-binds the listener.
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

      const tabsNow = tabsRef.current
      const activeIdxNow = activeIdxRef.current

      if (e.key === 't' && !e.shiftKey) {
        e.preventDefault()
        setTabs((prev) => [...prev, makeTab()])
        setActiveIdx(tabsNow.length)
        return
      }

      if (e.key === 'w' && e.shiftKey) {
        e.preventDefault()
        if (tabsNow.length <= 1) return
        const newIdx = activeIdxNow >= tabsNow.length - 1 ? activeIdxNow - 1 : activeIdxNow
        setTabs((prev) => prev.filter((_, i) => i !== activeIdxNow))
        setActiveIdx(Math.max(0, newIdx))
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        if (tabsNow.length <= 1) return
        if (e.shiftKey) {
          setActiveIdx(activeIdxNow === 0 ? tabsNow.length - 1 : activeIdxNow - 1)
        } else {
          setActiveIdx(activeIdxNow === tabsNow.length - 1 ? 0 : activeIdxNow + 1)
        }
      }

      if (e.key === '/' && !e.shiftKey) {
        e.preventDefault()
        setShowShortcuts((v) => !v)
        return
      }

      if (e.key === 'a' && e.shiftKey) {
        e.preventDefault()
        void handleAiAnswerRef.current?.()
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Ctrl+F opens the in-conversation search. Kept in its own effect (it is
  // allowed while typing, unlike the tab shortcuts above) so it can depend on
  // the search state without rebinding the whole shortcut handler.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.shiftKey || e.key !== 'f') return
      e.preventDefault()
      search.setSearchOpen(true)
      requestAnimationFrame(() => search.searchInputRef.current?.focus())
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [search])

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

  // Keep the once-registered shortcut handler pointing at the latest closure.
  useEffect(() => {
    handleAiAnswerRef.current = handleAiAnswer
  })

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
  const searchMatches = useMemo(
    () => findMessageMatches(allMessages, searchQuery),
    [allMessages, searchQuery]
  )

  const goToMatch = useCallback((dir: 1 | -1) => {
    if (searchMatches.length === 0) return
    search.setMatchIndex((prev) => {
      const clamped = Math.min(prev, searchMatches.length - 1)
      return (clamped + dir + searchMatches.length) % searchMatches.length
    })
  }, [search, searchMatches.length])

  // Reset the current match when the query changes
  useEffect(() => {
    search.setMatchIndex(0)
  }, [search, searchQuery])

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

  // ---- Message list scroll system (stick-to-bottom + virtualization) ----
  const { scrollRef, setStickToBottom, handleScroll, virtualizer } = useMessageListScroll({
    rows,
    messages: activeTab.messages,
    streamContent: chatStream.state.assistantContent,
    streaming: chatStream.state.isStreaming,
    activeIdx,
    searchOpen,
    searchMatches,
    matchIndex
  })

  // Send / resend / regenerate flow (extracted hook — see useClassroomSend.ts)
  const { sendingRef, handleSend, handleSendFromContent, handleRegenerate } = useClassroomSend({
    companion,
    textbook,
    activeIdx,
    tabsRef,
    chatStream,
    setTabs,
    updateTab,
    setSendError,
    streamOwnerIdxRef,
    setStickToBottom,
    focusInput: () => requestAnimationFrame(() => inputRef.current?.focus())
  })

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
  }, [activeIdx, setStickToBottom])

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
      <ClassroomTabBar
        tabs={tabs}
        activeIdx={activeIdx}
        onSelect={setActiveIdx}
        onClose={handleCloseTab}
        onNew={handleNewTab}
      />

      {/* Header */}
      <ClassroomHeader
        companionName={companion?.name ?? ''}
        companionIdentity={companion?.identity ?? ''}
        conversationId={activeTab.conversationId}
        title={activeTab.title}
        editingTitle={editingTitle}
        titleInput={titleInput}
        pace={activeTab.pace}
        classMode={activeTab.classMode}
        textbookTitle={textbook?.title ?? null}
        hasTextbookOriginal={!!textbook?.originalFile}
        readerOpen={readerOpen}
        isStreaming={chatStream.state.isStreaming}
        isReasoning={chatStream.state.reasoningContent.length > 0}
        dailyGoal={dailyGoal}
        todayMinutes={todayMinutes}
        endingClass={isLoading}
        onRename={handleRename}
        onTitleInputChange={setTitleInput}
        onSaveTitle={() => void handleSaveTitle()}
        onCancelEditTitle={() => setEditingTitle(false)}
        onPaceChange={(p) => updateTab(activeIdx, { pace: p })}
        onToggleFeynman={() => updateTab(activeIdx, {
          classMode: activeTab.classMode === 'feynman' ? 'standard' : 'feynman'
        })}
        onToggleReader={() => setReaderOpen((v) => !v)}
        onScreenshot={() => void handleScreenshot()}
        onEndClass={() => void handleEndClass()}
      />

      {/* In-conversation search (Ctrl+F) */}
      {searchOpen && (
        <ConversationSearchBar
          inputRef={searchInputRef}
          query={searchQuery}
          matchIndex={matchIndex}
          matchCount={searchMatches.length}
          onQueryChange={setSearchQuery}
          onGoToMatch={goToMatch}
          onClose={closeSearch}
        />
      )}

      {/* 左右分栏：聊天（左） + 教材阅读（右，可拖宽） */}
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0">
      {/* Messages */}
      <MessageList
        scrollRef={scrollRef}
        onScroll={handleScroll}
        rows={rows}
        virtualizer={virtualizer}
        companionName={companion.name}
        messageCount={allMessages.length}
        isStreaming={chatStream.state.isStreaming}
        reasoningContent={chatStream.state.reasoningContent}
        groundingFlagged={groundingFlagged}
        errorMessage={sendError ?? chatStream.state.error?.message}
        onRetry={
          activeTab.retryMessage
            ? () => void handleSend({ input: activeTab.retryMessage!.input, resend: true })
            : undefined
        }
        textbookId={textbook?.id ?? null}
        endResult={activeTab.endResult}
        redoing={redoing}
        onRewind={handleRewind}
        onEdit={handleEditMessage}
        onDelete={handleDeleteMessage}
        onRegenerate={handleRegenerate}
        onReviewNewCards={handleReviewNewCards}
        onContinueLearning={handleContinueLearning}
        onRedoArtifacts={() => void handleRedoArtifacts()}
      />

      {/* Input */}
      <ClassroomComposer
        input={activeTab.input}
        inputRef={inputRef}
        companionAvailable={!!companion}
        isStreaming={chatStream.state.isStreaming}
        sending={sendingRef.current}
        aiAnswering={aiAnswering}
        mathOpen={mathOpen}
        mathTab={mathTab}
        mathRef={mathRef}
        templateOpen={templateOpen}
        templateRef={templateRef}
        onInputChange={setActiveTabInput}
        onRequestSend={() => void handleSend()}
        onCancel={() => void chatStream.cancel()}
        onAiAnswer={() => void handleAiAnswer()}
        onToggleMath={() => { setMathOpen((v) => !v); setMathTab('greek') }}
        onSelectMathTab={setMathTab}
        onToggleTemplate={() => { setTemplateOpen((v) => !v); setMathOpen(false) }}
        onCloseTemplate={() => setTemplateOpen(false)}
        onTemplateInsert={(t) => { insertIntoInput(t); setTemplateOpen(false) }}
        onInsertText={insertIntoInput}
        onQuickAction={(prompt) => void handleSendFromContent(prompt)}
      />
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
        <ShortcutSheet onClose={() => setShowShortcuts(false)} />
      )}
    </div>
  )
}
