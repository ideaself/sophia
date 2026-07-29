import { useState, useEffect, useRef, useCallback } from 'react'
import { useChatStream } from './useChatStream'
import { ChatMessage } from './ChatMessage'
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
  endResult: { artifacts: number } | null
}

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
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const loadedIdRef = useRef<string | null>(null)
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

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeTab.messages, chatStream.state.assistantContent])

  // Tab switching - update input/messages
  useEffect(() => {
    setSendError(null)
  }, [activeIdx])

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

      await chatStream.send(builtMessages)

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
        updateTab(activeIdx, { endResult: { artifacts: result.artifacts }, conversationId: null, messages: [] })
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

      {/* Messages */}
      <div className="flex-1 overflow-auto p-6 space-y-4">
        {allMessages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-text-muted">
              开始和 <span className="text-text-secondary">{companion.name}</span> 对话吧。
              <br />
              试着提出一个你想探讨的问题。
            </p>
          </div>
        )}
        {allMessages.map((msg) => (
          <ChatMessage
            key={msg.id}
            id={msg.id}
            role={msg.role}
            content={msg.content}
            showActions={!chatStream.state.isStreaming && msg.role !== 'system'}
            onEdit={handleEditMessage}
            onDelete={handleDeleteMessage}
            onRegenerate={handleRegenerate}
          />
        ))}
        {(chatStream.state.error || sendError) && (
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
        {activeTab.endResult && (
          <div className="rounded border border-green-800 bg-green-900/30 px-4 py-3 text-sm text-green-300">
            <p className="font-medium">课程已结束</p>
            <p className="mt-1 text-xs text-green-400">
              已自动生成 {activeTab.endResult.artifacts} 个学习摘要（课堂总结、记忆卡片、学习日记等）
            </p>
          </div>
        )}
        <div ref={messagesEndRef} />
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
