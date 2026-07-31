import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useChatStream } from './useChatStream'
import { ChatMessage, type MessageHighlight } from './ChatMessage'
import { stopTTS } from '../hooks/useTTS'
import { loadTabs, saveTabs, serializeTabs } from '../../../shared/tab-persistence'

interface Companion {
  id: string
  name: string
  identity: string
}

interface Textbook {
  id: string
  title: string
}

interface ClassroomViewProps {
  companion: Companion | null
  textbook: Textbook | null
  chatStream: ReturnType<typeof useChatStream>
  loadConversationId?: string | null
  onConversationLoaded?: () => void
}

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface TabState {
  id: string
  title: string
  conversationId: string | null
  messages: DisplayMessage[]
  input: string
  retryMessage: { input: string; convId: string } | null
  endResult: { artifacts: number; farewell?: string } | null
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

const WORLD_ID = 'world_default'

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
    messages: [],
    input: '',
    retryMessage: null,
    endResult: null
  }
}

export function ClassroomView({ companion, textbook, chatStream, loadConversationId, onConversationLoaded }: ClassroomViewProps): React.ReactElement {
  const [initialTabs] = useState(() => loadTabs(localStorage))
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
  const [sendError, setSendError] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const loadedIdRef = useRef<string | null>(null)
  // In-conversation search (Ctrl+F)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Scroll behavior: stick to the bottom unless the user scrolls up
  const [stickToBottom, setStickToBottom] = useState(true)
  // Mirror of `tabs` for async callbacks — the render-closure `tabs` goes
  // stale inside .then() chains that run after later re-renders.
  const tabsRef = useRef(tabs)
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
              messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content }))
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
          id: m.id, role: m.role, content: m.content
        }))
        const newTab = makeTab(loadConversationId, conv.title)
        newTab.messages = loaded
        setTabs((prev) => [...prev, newTab])
        setActiveIdx(tabsRef.current.length)
        onConversationLoaded?.()
      })
    })
    return () => { cancelled = true }
  }, [loadConversationId])

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
    }
    prevCompanionIdRef.current = id
  }, [companion?.id])

  // Focus input on mount/companion change
  useEffect(() => {
    if (companion) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
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
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeSearch])

  // Keyboard shortcuts: Ctrl+T new tab, Ctrl+Shift+W close tab,
  // Ctrl+Tab / Ctrl+Shift+Tab switch tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return

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
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [tabs, activeIdx])

  const handleSend = async (retryInput?: string) => {
    const tab = tabs[activeIdx]
    if (!tab) return
    try {
      const userMessage = retryInput ?? tab.input.trim()
      if (!userMessage || !companion) return

      if (chatStream.state.isStreaming) {
        await chatStream.cancel()
      }

      setSendError(null)

      let convId = tab.conversationId
      if (!convId) {
        try {
          const conv = await window.sophia.data.createConversation({
            worldId: WORLD_ID,
            companionId: companion.id,
            textbookId: textbook?.id,
            title: userMessage.slice(0, 50)
          })
          convId = conv.id
          updateTab(activeIdx, { conversationId: convId, title: userMessage.slice(0, 50) })
        } catch {
          setSendError('创建对话失败，请重试')
          return
        }
      }

      try {
        await window.sophia.data.sendMessage({
          conversationId: convId,
          content: userMessage,
          role: 'user',
          worldId: WORLD_ID
        })
      } catch {
        try {
          const conv = await window.sophia.data.createConversation({
            worldId: WORLD_ID,
            companionId: companion.id,
            textbookId: textbook?.id,
            title: userMessage.slice(0, 50)
          })
          convId = conv.id
          updateTab(activeIdx, { conversationId: convId, title: userMessage.slice(0, 50) })
          await window.sophia.data.sendMessage({
            conversationId: convId,
            content: userMessage,
            role: 'user',
            worldId: WORLD_ID
          })
        } catch {
          setSendError('发送消息失败，对话可能已被删除')
          return
        }
      }

      const updatedMessages: DisplayMessage[] = [
        ...tab.messages,
        { id: `local-${Date.now()}`, role: 'user', content: userMessage }
      ]
      updateTab(activeIdx, { messages: updatedMessages, input: '', retryMessage: null })
      setStickToBottom(true)

      let builtMessages
      try {
        builtMessages = await window.sophia.chat.getPromptMessages({
          conversationId: convId,
          companionId: companion.id,
          textbookId: textbook?.id ?? null,
          userMessage,
          worldId: WORLD_ID
        })
      } catch {
        setSendError('无法加载角色数据，请重新选择学习伙伴')
        return
      }

      const thinkingEnabled = localStorage.getItem('sophia.thinkingEnabled') === '1'
      await chatStream.send(builtMessages, undefined, thinkingEnabled)

      const endPromise = chatStream.streamEnd
      if (endPromise) {
        try {
          const { content, finishReason } = await endPromise
          const isPartial = finishReason.startsWith('error:')
          if (content && convId) {
            await window.sophia.data.sendMessage({
              conversationId: convId,
              content,
              role: 'assistant',
              worldId: WORLD_ID
            })
          }
          if (content) {
            setTabs((prev) => {
              const next = [...prev]
              const t = next[activeIdx]
              if (t) t.messages = [...t.messages, { id: `assistant-${Date.now()}`, role: 'assistant', content }]
              return next
            })
          }
          if (isPartial) {
            setTabs((prev) => {
              const next = [...prev]
              const t = next[activeIdx]
              if (t) t.retryMessage = { input: userMessage, convId: convId! }
              return next
            })
            setSendError('回复被中断，已保存部分内容。可重试获取完整回复。')
          }
        } catch {
          setTabs((prev) => {
            const next = [...prev]
            const t = next[activeIdx]
            if (t) t.retryMessage = { input: userMessage, convId: convId! }
            return next
          })
        }
      }

      inputRef.current?.focus()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : '发送失败，请重试')
    }
  }

  const handleEndClass = async () => {
    if (!activeTab.conversationId) return
    setIsLoading(true)
    try {
      const result = await window.sophia.data.endConversation(activeTab.conversationId, WORLD_ID)
      if (result.success) {
        updateTab(activeIdx, { endResult: { artifacts: result.artifacts, farewell: result.farewell }, conversationId: null, messages: [] })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleRename = () => {
    if (!activeTab.conversationId) return
    setEditingTitle(true)
    setTitleInput(activeTab.title)
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

  const handleEditMessage = async (messageId: string, content: string) => {
    if (!activeTab.conversationId) return
    await window.sophia.data.updateMessage(activeTab.conversationId, messageId, content)
    setTabs((prev) => {
      const next = [...prev]
      const t = next[activeIdx]
      if (t) {
        t.messages = t.messages.map((m) => m.id === messageId ? { ...m, content } : m)
      }
      return next
    })
  }

  const handleDeleteMessage = async (messageId: string) => {
    if (!activeTab.conversationId) return
    await window.sophia.data.deleteMessage(activeTab.conversationId, messageId)
    setTabs((prev) => {
      const next = [...prev]
      const t = next[activeIdx]
      if (t) t.messages = t.messages.filter((m) => m.id !== messageId)
      return next
    })
  }

  const handleRegenerate = async (messageId: string) => {
    const msgs = activeTab.messages
    const msgIdx = msgs.findIndex((m) => m.id === messageId)
    if (msgIdx < 0) return

    // Remove this assistant message and find the last user message before it
    const newMessages = msgs.slice(0, msgIdx)
    setTabs((prev) => {
      const next = [...prev]
      const t = next[activeIdx]
      if (t) t.messages = newMessages
      return next
    })

    // Delete the assistant message from DB
    if (activeTab.conversationId) {
      await window.sophia.data.deleteMessage(activeTab.conversationId, messageId)
    }

    // Find the last user message to resend
    const lastUserMsg = [...newMessages].reverse().find((m) => m.role === 'user')
    if (lastUserMsg) {
      await handleSendFromContent(lastUserMsg.content)
    }
  }

  const handleSendFromContent = async (content: string) => {
    // handleSend takes the content directly (retryInput), so there's no
    // need to round-trip it through tab input state or defer with setTimeout.
    await handleSend(content)
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
  const allMessages = [...activeTab.messages]
  if (chatStream.state.isStreaming && chatStream.state.assistantContent) {
    allMessages.push({
      id: 'streaming',
      role: 'assistant',
      content: chatStream.state.assistantContent
    })
  }

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
    chatStream.state.reasoningContent,
    chatStream.state.error,
    sendError,
    activeTab.endResult
  ])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120,
    overscan: 10,
    getItemKey: (index) => rows[index].key
  })

  // Auto-scroll to the newest message while pinned to the bottom.
  useEffect(() => {
    if (!stickToBottom || rows.length === 0) return
    const el = scrollRef.current
    if (!el) return
    virtualizer.scrollToOffset(virtualizer.getTotalSize(), { align: 'end' })
    // Re-scroll once the newly mounted bottom rows have been measured —
    // `getTotalSize()` is only an estimate until then.
    const raf = requestAnimationFrame(() => {
      virtualizer.measure()
      virtualizer.scrollToOffset(virtualizer.getTotalSize(), { align: 'end' })
    })
    return () => cancelAnimationFrame(raf)
  }, [activeTab.messages, chatStream.state.assistantContent, stickToBottom, rows.length])

  // Scroll the current search match into view.
  useEffect(() => {
    if (searchMatches.length === 0) return
    const target = searchMatches[Math.min(matchIndex, searchMatches.length - 1)]
    setStickToBottom(false)
    virtualizer.scrollToIndex(target, { align: 'center' })
  }, [matchIndex, searchMatches])

  // Pin to the bottom when a new stream starts.
  const prevStreamingRef = useRef(false)
  useEffect(() => {
    if (chatStream.state.isStreaming && !prevStreamingRef.current) {
      setStickToBottom(true)
    }
    prevStreamingRef.current = chatStream.state.isStreaming
  }, [chatStream.state.isStreaming])

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
                        if (e.key === 'Enter') handleSaveTitle()
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
            {textbook && (
              <span className="rounded-full bg-bg-elevated px-3 py-1 text-xs">
                📖 {textbook.title}
              </span>
            )}
            {chatStream.state.isStreaming && (
              <span className="text-xs text-amber-400 animate-pulse">正在思考...</span>
            )}
            {activeTab.conversationId && (
              <button
                onClick={handleEndClass}
                disabled={isLoading}
                className="rounded border border-amber-700 px-3 py-1 text-xs text-amber-400 hover:bg-amber-900/30 disabled:opacity-50"
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
              if (e.key === 'Enter') {
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
                            🧠 思考过程 {chatStream.state.isStreaming && <span className="text-amber-400 animate-pulse">(进行中...)</span>}
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">
                            {chatStream.state.reasoningContent}
                          </p>
                        </details>
                      )}
                      <ChatMessage
                        id={row.msg.id}
                        role={row.msg.role}
                        content={row.msg.content}
                        showActions={!chatStream.state.isStreaming && row.msg.role !== 'system'}
                        highlight={row.highlight}
                        onEdit={handleEditMessage}
                        onDelete={handleDeleteMessage}
                        onRegenerate={handleRegenerate}
                      />
                    </>
                  )}
                  {row.kind === 'error' && (
                    <div className="rounded border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">发送失败</p>
                          <p className="mt-1 text-xs text-red-400">{sendError ?? chatStream.state.error?.message}</p>
                        </div>
                        {activeTab.retryMessage && (
                          <button
                            onClick={() => handleSend(activeTab.retryMessage!.input)}
                            className="rounded bg-red-800 px-3 py-1 text-xs text-red-200 hover:bg-red-700"
                          >
                            重试
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {row.kind === 'end' && activeTab.endResult && (
                    <div className="rounded border border-green-800 bg-green-900/30 px-4 py-3 text-sm text-green-300">
                      <p className="font-medium">课程已结束</p>
                      {activeTab.endResult.farewell && (
                        <p className="mt-2 text-sm text-green-200 italic">{activeTab.endResult.farewell}</p>
                      )}
                      <p className="mt-1 text-xs text-green-400">
                        已自动生成 {activeTab.endResult.artifacts} 个学习摘要（课堂总结、记忆卡片、学习日记等）
                      </p>
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
        <div className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={activeTab.input}
            onChange={(e) => setActiveTabInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="输入你的问题... (Enter 发送)"
            disabled={chatStream.state.isStreaming}
            className="flex-1 rounded border border-surface-border-strong bg-bg-deep px-4 py-2 text-sm text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none disabled:opacity-50"
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
              disabled={!activeTab.input.trim()}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
