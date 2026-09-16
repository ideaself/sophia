/**
 * Classroom send / resend / regenerate flow.
 *
 * Extracted from ClassroomView (the component had grown past 1700 lines).
 * The behaviour is intentionally unchanged from the in-component version:
 * - sends are de-duplicated by `sendingRef` until the stream truly starts;
 * - fresh sends persist the user message exactly once and append one bubble;
 * - resend (retry / regenerate) never re-persists the user message;
 * - regenerate truncates the stored history through the last user message
 *   and drops everything after it (UI + DB) before asking again.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { CreateChatStreamControllerResult } from '../../../shared/chat-stream-controller'
import { loadThinkingMode, shouldUseThinking } from '../../../shared/thinking'
import { MAX_INPUT_LENGTH, type TabState } from './types'

export interface SendCompanion {
  id: string
  name: string
  version?: number
}

export interface SendTextbook {
  id: string
}

export interface UseClassroomSendOptions {
  companion: SendCompanion | null
  textbook: SendTextbook | null
  activeIdx: number
  tabsRef: RefObject<TabState[]>
  chatStream: CreateChatStreamControllerResult
  setTabs: Dispatch<SetStateAction<TabState[]>>
  updateTab: (idx: number, patch: Partial<TabState>) => void
  setSendError: (message: string | null) => void
  streamOwnerIdxRef: MutableRefObject<number | null>
  setStickToBottom: (value: boolean) => void
  /** Restore focus to the composer after the stream ends. */
  focusInput: () => void
}

export interface ClassroomSend {
  /** True from the send click until the stream actually starts (防重). */
  sendingRef: MutableRefObject<boolean>
  handleSend: (options?: { input?: string; resend?: boolean }) => Promise<void>
  handleSendFromContent: (content: string) => Promise<void>
  handleRegenerate: (messageId: string) => Promise<void>
}

export function useClassroomSend(options: UseClassroomSendOptions): ClassroomSend {
  const {
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
    focusInput
  } = options

  // 发送防重：从按下发送到流式真正开始的间隙（构建 prompt 可能要一两秒）
  // 期间没有 isStreaming 标记，连按 Enter 会重复创建会话/发送多条。
  const sendingRef = useRef(false)

  const handleSend = async (sendOptions?: { input?: string; resend?: boolean }): Promise<void> => {
    if (sendingRef.current) return
    sendingRef.current = true
    try {
      // 从 ref 读最新状态：重试/重新生成会在 await 后回调本次发送，
      // 渲染闭包里的 tabs 可能已经过期（会复活被删消息、重复 user 消息）。
      const tab = tabsRef.current[activeIdx]
      if (!tab) return
      const userMessage = sendOptions?.input ?? tab.input.trim()
      // resend：该用户消息已在库中（重试 / 重新生成），不能重复持久化、重复上屏。
      const isResend = sendOptions?.resend === true
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
            companionVersion: companion.version ?? undefined,
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
              companionVersion: companion.version ?? undefined,
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
      focusInput()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : '发送失败，请重试')
    } finally {
      sendingRef.current = false
    }
  }

  // Latest-value ref so the memoized regenerate handler stays identity-stable
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
  }, [activeIdx, setTabs, tabsRef])

  const handleSendFromContent = async (content: string): Promise<void> => {
    await handleSend({ input: content })
  }

  return { sendingRef, handleSend, handleSendFromContent, handleRegenerate }
}
