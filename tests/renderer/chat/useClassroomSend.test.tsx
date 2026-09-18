// @vitest-environment jsdom
/**
 * useClassroomSend — send/resend/regenerate flows including the error and
 * interruption branches (the hook is exercised directly through renderHook).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useClassroomSend } from '../../../src/renderer/src/chat/useClassroomSend'
import { MAX_INPUT_LENGTH, type TabState } from '../../../src/renderer/src/chat/types'

const data = {
  createConversation: vi.fn(),
  sendMessage: vi.fn(),
  truncateConversation: vi.fn()
}
const chat = { getPromptMessages: vi.fn(async () => [{ role: 'user', content: 'prompt' }]) }
const dialog = {
  confirm: vi.fn(async (_options: { message: string; confirmLabel?: string }) => true)
}

interface HarnessOptions {
  activeIdx?: number
  input?: string
  conversationId?: string | null
  companion?: { id: string; name: string; version?: number } | null
  /** Simulate a stream running in another tab. */
  streamOwnerIdx?: number | null
  streamEnd?: Promise<{ content: string; finishReason: string }> | null
}

function setup(options: HarnessOptions = {}): {
  result: { current: ReturnType<typeof useClassroomSend> }
  tab: () => TabState
  tabs: () => TabState[]
  setSendError: ReturnType<typeof vi.fn>
  /** Empty the store backing setTabs without touching tabsRef (stale-ref race). */
  shrinkStore: () => void
  chatStream: {
    state: { isStreaming: boolean; assistantContent: string; reasoningContent: string }
    send: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
    streamEnd: Promise<{ content: string; finishReason: string }> | null
  }
  focusInput: ReturnType<typeof vi.fn>
  setStickToBottom: ReturnType<typeof vi.fn>
  streamOwnerIdxRef: { current: number | null }
} {
  const makeTab = (conversationId: string | null, input: string): TabState => ({
    id: `tab_${conversationId ?? 'new'}`,
    title: conversationId ? '已有会话' : '新对话',
    conversationId,
    classMode: 'standard',
    pace: 'normal',
    messages: [],
    input,
    retryMessage: null,
    endResult: null
  })

  const activeIdx = options.activeIdx ?? 0
  const tabs = options.activeIdx === 1
    ? [makeTab('conv_old', ''), makeTab(options.conversationId ?? null, options.input ?? '')]
    : [makeTab(options.conversationId ?? null, options.input ?? '')]

  let currentTabs = tabs
  const tabsRef = { current: currentTabs }
  const setTabs = (updater: (prev: TabState[]) => TabState[]): void => {
    currentTabs = updater(currentTabs)
    tabsRef.current = currentTabs
  }
  const updateTab = vi.fn((idx: number, patch: Partial<TabState>): void => {
    currentTabs = currentTabs.map((t, i) => (i === idx ? { ...t, ...patch } : t))
    tabsRef.current = currentTabs
  })
  const shrinkStore = (): void => {
    currentTabs = []
  }

  const chatStream = {
    state: {
      isStreaming: options.streamOwnerIdx !== undefined && options.streamOwnerIdx !== null,
      assistantContent: '',
      reasoningContent: ''
    },
    send: vi.fn(),
    cancel: vi.fn(async () => {}),
    streamEnd: options.streamEnd ?? null
  }
  const streamOwnerIdxRef = { current: options.streamOwnerIdx ?? null }
  const setSendError = vi.fn()
  const setStickToBottom = vi.fn()
  const focusInput = vi.fn()

  const { result } = renderHook(() =>
    useClassroomSend({
      companion: options.companion === undefined ? { id: 'comp_landau', name: '朗道', version: 1 } : options.companion,
      textbook: null,
      activeIdx,
      tabsRef: tabsRef as never,
      chatStream: chatStream as never,
      setTabs: setTabs as never,
      updateTab,
      setSendError,
      streamOwnerIdxRef: streamOwnerIdxRef as never,
      setStickToBottom,
      focusInput
    })
  )

  return {
    result,
    tab: () => tabsRef.current[activeIdx],
    tabs: () => tabsRef.current,
    setSendError,
    shrinkStore,
    chatStream,
    focusInput,
    setStickToBottom,
    streamOwnerIdxRef
  }
}

beforeEach(() => {
  localStorage.clear()
  data.createConversation.mockReset().mockResolvedValue({ id: 'conv_new', title: '新会话' })
  data.sendMessage.mockReset().mockResolvedValue({ id: 'msg_1' })
  data.truncateConversation.mockReset().mockResolvedValue(true)
  chat.getPromptMessages.mockClear()
  dialog.confirm.mockReset().mockResolvedValue(true)

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data, chat, dialog }
  })
})

afterEach(cleanup)

describe('useClassroomSend — fresh sends', () => {
  it('creates the conversation, persists and appends the user message', async () => {
    const h = setup({ input: '熵是什么？' })

    await h.result.current.handleSend()

    expect(data.createConversation).toHaveBeenCalledTimes(1)
    const created = data.createConversation.mock.calls[0][0] as { title: string; companionId: string }
    expect(created.companionId).toBe('comp_landau')
    expect(created.title).toMatch(/^\d{2}-\d{2} 朗道$/)

    expect(data.sendMessage).toHaveBeenCalledTimes(1)
    expect(data.sendMessage.mock.calls[0][0]).toMatchObject({
      conversationId: 'conv_new',
      content: '熵是什么？',
      role: 'user'
    })

    const tab = h.tab()
    expect(tab.conversationId).toBe('conv_new')
    expect(tab.input).toBe('')
    expect(tab.messages.map((m) => m.content)).toEqual(['熵是什么？'])
    expect(h.setStickToBottom).toHaveBeenCalledWith(true)
    expect(chat.getPromptMessages).toHaveBeenCalledTimes(1)
    expect(h.chatStream.send).toHaveBeenCalledTimes(1)
    expect(h.focusInput).toHaveBeenCalled()
  })

  it('reuses an existing conversation and ignores empty input or missing companion', async () => {
    const withConv = setup({ input: '继续', conversationId: 'conv_1' })
    await withConv.result.current.handleSend()
    expect(data.createConversation).not.toHaveBeenCalled()
    expect(data.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv_1' })
    )

    data.sendMessage.mockClear()
    const empty = setup({ input: '   ' })
    await empty.result.current.handleSend()
    expect(data.sendMessage).not.toHaveBeenCalled()

    const noCompanion = setup({ input: '你好', companion: null })
    await noCompanion.result.current.handleSend()
    expect(data.sendMessage).not.toHaveBeenCalled()
  })

  it('de-duplicates concurrent sends until the stream starts', async () => {
    const h = setup({ input: '并发' })

    await Promise.all([
      h.result.current.handleSend(),
      h.result.current.handleSend(),
      h.result.current.handleSend()
    ])

    expect(data.sendMessage).toHaveBeenCalledTimes(1)
    expect(h.chatStream.send).toHaveBeenCalledTimes(1)
  })

  it('rejects over-long input', async () => {
    const h = setup({ input: 'x'.repeat(MAX_INPUT_LENGTH + 1) })

    await h.result.current.handleSend()

    expect(h.setSendError).toHaveBeenCalledWith(
      expect.stringContaining(`上限 ${MAX_INPUT_LENGTH} 字`)
    )
    expect(data.sendMessage).not.toHaveBeenCalled()
  })
})

describe('useClassroomSend — failure branches', () => {
  it('reports conversation creation failures', async () => {
    data.createConversation.mockRejectedValueOnce(new Error('db down'))
    const h = setup({ input: '你好' })

    await h.result.current.handleSend()

    expect(h.setSendError).toHaveBeenCalledWith('创建对话失败，请重试')
    expect(data.sendMessage).not.toHaveBeenCalled()
  })

  it('recovers from a failed persist by recreating the conversation', async () => {
    data.sendMessage.mockRejectedValueOnce(new Error('conversation deleted'))
    const h = setup({ input: '重试入库' })

    await h.result.current.handleSend()

    // First attempt failed → conversation recreated, message persisted again.
    expect(data.createConversation).toHaveBeenCalledTimes(2)
    expect(data.sendMessage).toHaveBeenCalledTimes(2)
    expect(h.setSendError).not.toHaveBeenCalledWith('发送消息失败，对话可能已被删除')
    expect(h.tab().messages).toHaveLength(1)
  })

  it('surfaces a double persist failure', async () => {
    data.sendMessage.mockRejectedValue(new Error('db down'))
    const h = setup({ input: '双重失败' })

    await h.result.current.handleSend()

    expect(h.setSendError).toHaveBeenCalledWith('发送消息失败，对话可能已被删除')
    expect(h.tab().messages).toHaveLength(0)
  })

  it('reports prompt loading failures', async () => {
    chat.getPromptMessages.mockRejectedValueOnce(new Error('companion gone'))
    const h = setup({ input: '你好' })

    await h.result.current.handleSend()

    expect(h.setSendError).toHaveBeenCalledWith('无法加载角色数据，请重新选择学习伙伴')
    expect(h.chatStream.send).not.toHaveBeenCalled()
  })

  it('refuses resend without a conversation', async () => {
    const h = setup({ input: '重发', conversationId: null })

    await h.result.current.handleSend({ resend: true })

    expect(h.setSendError).toHaveBeenCalledWith('对话状态异常，请重新开始课堂')
  })
})

describe('useClassroomSend — interruption handling', () => {
  it('asks before interrupting a stream owned by another tab', async () => {
    const h = setup({ input: '抢发', activeIdx: 1, conversationId: 'conv_b', streamOwnerIdx: 0 })

    dialog.confirm.mockResolvedValueOnce(false)
    await h.result.current.handleSend()
    expect(h.chatStream.cancel).not.toHaveBeenCalled()
    expect(data.sendMessage).not.toHaveBeenCalled()

    dialog.confirm.mockResolvedValueOnce(true)
    await h.result.current.handleSend()
    expect(dialog.confirm.mock.calls[0][0].message).toContain('正在回复中')
    expect(h.chatStream.cancel).toHaveBeenCalled()
    expect(data.sendMessage).toHaveBeenCalled()
  })

  it('keeps a partial reply, flags it for retry and warns', async () => {
    const streamEnd = Promise.resolve({ content: '半截回答', finishReason: 'error:timeout' })
    const h = setup({ input: '问题', conversationId: 'conv_1', streamEnd })

    await h.result.current.handleSend()

    // Partial content is persisted and shown…
    expect(data.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: '半截回答' })
    )
    expect(h.tab().messages.map((m) => m.content)).toContain('半截回答')
    // …and the turn is flagged retryable.
    expect(h.tab().retryMessage).toEqual({ input: '问题', convId: 'conv_1' })
    expect(h.setSendError).toHaveBeenCalledWith(expect.stringContaining('回复被中断'))
    expect(h.streamOwnerIdxRef.current).toBeNull()
  })

  it('flags the turn for retry when the stream rejects', async () => {
    const streamEnd = Promise.reject(new Error('stream died'))
    const h = setup({ input: '问题', conversationId: 'conv_1', streamEnd })

    await h.result.current.handleSend()

    expect(h.tab().retryMessage).toEqual({ input: '问题', convId: 'conv_1' })
    expect(h.streamOwnerIdxRef.current).toBeNull()
    expect(h.focusInput).toHaveBeenCalled()
  })
})

describe('useClassroomSend — resend and regenerate', () => {
  it('resends without persisting the user message twice', async () => {
    const h = setup({ conversationId: 'conv_1' })
    h.tabs()[0].messages = [
      { id: 'm1', role: 'user', content: '原问题' },
      { id: 'm2', role: 'assistant', content: '旧回答' }
    ]

    await h.result.current.handleSend({ input: '原问题', resend: true })

    expect(data.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ role: 'user' }))
    expect(h.tab().messages).toHaveLength(2)
  })

  it('regenerates by truncating the stored history and reseeding the turn', async () => {
    const h = setup({ conversationId: 'conv_1' })
    h.tabs()[0].messages = [
      { id: 'm1', role: 'user', content: '原问题' },
      { id: 'm2', role: 'assistant', content: '旧回答' },
      { id: 'm3', role: 'user', content: '追问' }
    ]

    await h.result.current.handleRegenerate('m2')

    expect(data.truncateConversation).toHaveBeenCalledWith('conv_1', 'm1')
    expect(h.tab().messages.map((m) => m.id)).toEqual(['m1'])
    // The user turn is resent without re-persisting or re-appending it.
    expect(h.chatStream.send).toHaveBeenCalledTimes(1)
  })

  it('ignores regenerate requests without a user turn', async () => {
    const h = setup({ conversationId: 'conv_1' })
    h.tabs()[0].messages = [{ id: 'm1', role: 'assistant', content: '回答' }]

    await h.result.current.handleRegenerate('m1')

    expect(data.truncateConversation).not.toHaveBeenCalled()
    expect(h.chatStream.send).not.toHaveBeenCalled()
  })

  it('passes quick-action content into the send flow', async () => {
    const h = setup({ conversationId: 'conv_1' })

    await h.result.current.handleSendFromContent('快速提问')

    expect(data.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: '快速提问', role: 'user' })
    )
  })
})

describe('useClassroomSend — branch closure', () => {
  it('skips the owner confirmation when the stream has no recorded owner', async () => {
    const h = setup({ input: '抢发', activeIdx: 1, conversationId: 'conv_b', streamOwnerIdx: 0 })
    h.streamOwnerIdxRef.current = null

    await h.result.current.handleSend()

    expect(dialog.confirm).not.toHaveBeenCalled()
    expect(h.chatStream.cancel).toHaveBeenCalled()
    expect(data.sendMessage).toHaveBeenCalled()
  })

  it('skips the owner confirmation when the stream belongs to this tab', async () => {
    const h = setup({ input: '自我抢发', activeIdx: 0, conversationId: 'conv_a', streamOwnerIdx: 0 })

    await h.result.current.handleSend()

    expect(dialog.confirm).not.toHaveBeenCalled()
    expect(h.chatStream.cancel).toHaveBeenCalled()
    expect(data.sendMessage).toHaveBeenCalled()
  })

  it('names a vanished owner tab in the interruption prompt', async () => {
    const h = setup({ input: '抢发', activeIdx: 1, conversationId: 'conv_b', streamOwnerIdx: 5 })
    dialog.confirm.mockResolvedValueOnce(false)

    await h.result.current.handleSend()

    expect(dialog.confirm).toHaveBeenCalledTimes(1)
    expect((dialog.confirm.mock.calls[0][0] as { message: string }).message).toContain('其他标签')
  })

  it('passes undefined companion versions to the conversation store', async () => {
    const h = setup({ input: '无版本', companion: { id: 'comp_no_version', name: '无版本伙伴' } })

    await h.result.current.handleSend()

    expect(
      (data.createConversation.mock.calls[0][0] as { companionVersion?: number }).companionVersion
    ).toBeUndefined()
  })

  it('passes undefined companion versions when recreating after a failed persist', async () => {
    data.sendMessage.mockRejectedValueOnce(new Error('gone'))
    const h = setup({
      input: '恢复',
      conversationId: 'conv_1',
      companion: { id: 'comp_no_version', name: '无版本伙伴' }
    })

    await h.result.current.handleSend()

    expect(data.createConversation).toHaveBeenCalledTimes(1)
    expect(
      (data.createConversation.mock.calls[0][0] as { companionVersion?: number }).companionVersion
    ).toBeUndefined()
  })

  it('drops the user bubble when its tab disappears during persistence', async () => {
    const h = setup({ input: '并发清空', conversationId: 'conv_1' })
    data.sendMessage.mockImplementationOnce(async () => {
      h.tabs().length = 0
      return { id: 'msg_1' }
    })

    await h.result.current.handleSend()

    expect(h.tabs()).toHaveLength(0)
    expect(h.chatStream.send).toHaveBeenCalled()
  })

  it('uses the active tab when the stream owner was cleared mid-send', async () => {
    const streamEnd = Promise.resolve({ content: '归属回答', finishReason: 'stop' })
    const h = setup({ input: '归属', conversationId: 'conv_1', streamEnd })
    h.chatStream.send.mockImplementationOnce(() => {
      h.streamOwnerIdxRef.current = null
    })

    await h.result.current.handleSend()

    expect(h.tab().messages.map((m) => m.content)).toContain('归属回答')
  })

  it('skips persistence and the bubble for an empty final reply', async () => {
    const streamEnd = Promise.resolve({ content: '', finishReason: 'stop' })
    const h = setup({ input: '空回复', conversationId: 'conv_1', streamEnd })

    await h.result.current.handleSend()

    expect(data.sendMessage).toHaveBeenCalledTimes(1)
    expect(h.tab().messages).toHaveLength(1)
    expect(h.tab().messages[0].content).toBe('空回复')
    expect(h.tab().retryMessage).toBeNull()
  })

  it('skips the assistant bubble when the tab disappears before the reply lands', async () => {
    const streamEnd = Promise.resolve({ content: '迟到回答', finishReason: 'stop' })
    const h = setup({ input: '标签没了', conversationId: 'conv_1', streamEnd })
    h.chatStream.send.mockImplementationOnce(() => {
      h.tabs().length = 0
    })

    await h.result.current.handleSend()

    expect(data.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: '迟到回答' })
    )
    expect(h.tabs()).toHaveLength(0)
  })

  it('skips the retry flag when the tab disappears before a partial reply', async () => {
    const streamEnd = Promise.resolve({ content: '半截', finishReason: 'error:timeout' })
    const h = setup({ input: '部分', conversationId: 'conv_1', streamEnd })
    h.chatStream.send.mockImplementationOnce(() => {
      h.tabs().length = 0
    })

    await h.result.current.handleSend()

    expect(h.setSendError).toHaveBeenCalledWith(expect.stringContaining('回复被中断'))
    expect(h.tabs()).toHaveLength(0)
  })

  it('skips the retry flag when the tab disappears before a rejection', async () => {
    const streamEnd = Promise.reject(new Error('died'))
    const h = setup({ input: '失败', conversationId: 'conv_1', streamEnd })
    h.chatStream.send.mockImplementationOnce(() => {
      h.tabs().length = 0
    })

    await h.result.current.handleSend()

    expect(h.focusInput).toHaveBeenCalled()
    expect(h.tabs()).toHaveLength(0)
  })

  it('tolerates regenerate without any tab', async () => {
    const h = setup({ conversationId: 'conv_1' })
    h.tabs().length = 0

    await h.result.current.handleRegenerate('missing')

    expect(data.truncateConversation).not.toHaveBeenCalled()
    expect(h.chatStream.send).not.toHaveBeenCalled()
  })

  it('regenerates without truncating when the tab has no conversation', async () => {
    const h = setup({ conversationId: null })
    h.tabs()[0].messages = [
      { id: 'm1', role: 'user', content: '原问题' },
      { id: 'm2', role: 'assistant', content: '旧回答' }
    ]

    await h.result.current.handleRegenerate('m2')

    expect(data.truncateConversation).not.toHaveBeenCalled()
    expect(h.setSendError).toHaveBeenCalledWith('对话状态异常，请重新开始课堂')
  })

  it('drops the regenerated list when the tab store shrank first', async () => {
    const h = setup({ conversationId: 'conv_1' })
    h.tabs()[0].messages = [
      { id: 'm1', role: 'user', content: '原问题' },
      { id: 'm2', role: 'assistant', content: '旧回答' }
    ]
    h.shrinkStore()

    await h.result.current.handleRegenerate('m2')

    expect(data.truncateConversation).toHaveBeenCalledWith('conv_1', 'm1')
    expect(h.chatStream.send).not.toHaveBeenCalled()
  })
})
