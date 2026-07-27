import { useState, useEffect, useRef } from 'react'
import { useChatStream } from './useChatStream'
import { ChatMessage } from './ChatMessage'

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
  /** When set, load this conversation's messages and resume it */
  loadConversationId?: string | null
  /** Called after a conversation is loaded (so parent can clear the prop) */
  onConversationLoaded?: () => void
}

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

const WORLD_ID = 'world_default'

export function ClassroomView({ companion, textbook, chatStream, loadConversationId, onConversationLoaded }: ClassroomViewProps): React.ReactElement {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const loadedIdRef = useRef<string | null>(null)

  // Load a conversation from DB when loadConversationId changes
  useEffect(() => {
    if (!loadConversationId || loadConversationId === loadedIdRef.current) return
    loadedIdRef.current = loadConversationId

    let cancelled = false
    window.sophia.data.listMessages(loadConversationId).then((msgs) => {
      if (cancelled) return
      const loaded: DisplayMessage[] = msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content
      }))
      setMessages(loaded)
      setConversationId(loadConversationId)
      onConversationLoaded?.()
    })

    return () => { cancelled = true }
  }, [loadConversationId, onConversationLoaded])

  // Reset loadedIdRef when conversation is cleared (e.g. after endClass)
  useEffect(() => {
    if (!conversationId) {
      loadedIdRef.current = null
    }
  }, [conversationId])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatStream.state.assistantContent])

  // Last failed message for retry
  const [retryMessage, setRetryMessage] = useState<{ input: string; convId: string } | null>(null)

  const handleSend = async (retryInput?: string) => {
    const userMessage = retryInput ?? input.trim()
    if (!userMessage || chatStream.state.isStreaming || !companion) return

    setInput('')
    setRetryMessage(null)

    // Create conversation on first message
    let convId = conversationId
    if (!convId) {
      const conv = await window.sophia.data.createConversation({
        worldId: WORLD_ID,
        companionId: companion.id,
        textbookId: textbook?.id,
        title: userMessage.slice(0, 50)
      })
      convId = conv.id
      setConversationId(convId)
    }

    // Save user message
    await window.sophia.data.sendMessage({
      conversationId: convId,
      content: userMessage,
      role: 'user',
      worldId: WORLD_ID
    })

    const updatedMessages: DisplayMessage[] = [
      ...messages,
      { id: `local-${Date.now()}`, role: 'user', content: userMessage }
    ]
    setMessages(updatedMessages)

    // Build messages with system prompt via main-process handler
    const builtMessages = await window.sophia.chat.getPromptMessages({
      conversationId: convId,
      companionId: companion.id,
      textbookId: textbook?.id ?? null,
      userMessage,
      worldId: WORLD_ID
    })

    // Send and wait for stream to finish
    await chatStream.send(builtMessages)

    // Wait for streamEnd promise to resolve (stream finished)
    const endPromise = chatStream.streamEnd
    if (endPromise) {
      try {
        const { content } = await endPromise
        // Persist assistant message to DB
        if (content && convId) {
          await window.sophia.data.sendMessage({
            conversationId: convId,
            content,
            role: 'assistant',
            worldId: WORLD_ID
          })
        }
        // Add assistant message to display state so it survives across turns
        if (content) {
          setMessages((prev) => [
            ...prev,
            { id: `assistant-${Date.now()}`, role: 'assistant', content }
          ])
        }
      } catch {
        // Stream was cancelled or errored — save retry info
        setRetryMessage({ input: userMessage, convId: convId! })
      }
    }

    // Auto-focus input after streaming ends
    inputRef.current?.focus()
  }

  // Handle end class
  const [endResult, setEndResult] = useState<{ artifacts: number } | null>(null)
  const handleEndClass = async () => {
    if (!conversationId) return
    setIsLoading(true)
    setEndResult(null)
    try {
      const result = await window.sophia.data.endConversation(conversationId, WORLD_ID)
      if (result.success) {
        setEndResult({ artifacts: result.artifacts })
        setConversationId(null)
        setMessages([])
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Build display messages including streaming content
  const allMessages = [...messages]
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
      {/* Header */}
      <div className="border-b border-surface-border bg-bg-surface px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">{companion.name}</h2>
            <p className="text-xs text-text-muted">{companion.identity}</p>
          </div>
          <div className="flex items-center gap-3">
            {textbook && (
              <span className="rounded-full bg-bg-elevated px-3 py-1 text-xs">
                📖 {textbook.title}
              </span>
            )}
            {conversationId && (
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
          <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
        ))}
        {chatStream.state.error && (
          <div className="rounded border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">发送失败</p>
                <p className="mt-1 text-xs text-red-400">{chatStream.state.error.message}</p>
              </div>
              {retryMessage && (
                <button
                  onClick={() => handleSend(retryMessage.input)}
                  className="rounded bg-red-800 px-3 py-1 text-xs text-red-200 hover:bg-red-700"
                >
                  重试
                </button>
              )}
            </div>
          </div>
        )}
        {endResult && (
          <div className="rounded border border-green-800 bg-green-900/30 px-4 py-3 text-sm text-green-300">
            <p className="font-medium">课程已结束</p>
            <p className="mt-1 text-xs text-green-400">
              已自动生成 {endResult.artifacts} 个学习摘要（课堂总结、记忆卡片、学习日记等）
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
              onClick={handleSend}
              disabled={!input.trim()}
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
