// @vitest-environment jsdom
/**
 * ClassroomView — regression tests for the send/regenerate flow.
 *
 * Locks the batch-1 fixes: regenerate must truncate the stored history
 * through the last user message and resend WITHOUT persisting the user
 * message twice, while the UI keeps a single copy of that turn.
 *
 * jsdom lacks layout: the virtualizer needs a ResizeObserver + a non-zero
 * bounding rect, both stubbed below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

import { ClassroomView } from '../../../src/renderer/src/chat/ClassroomView'
import {
  createChatStreamController,
  type ChatAPI
} from '../../../src/shared/chat-stream-controller'
import { CLASSROOM_TABS_KEY } from '../../../src/shared/tab-persistence'
import type { Companion } from '../../../src/renderer/src/types/models'

// --------------- jsdom layout stubs ---------------

class FakeResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.cb(
      [{ target, contentRect: { width: 800, height: 600, top: 0, left: 0, bottom: 600, right: 800, x: 0, y: 0 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver
    )
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  Element.prototype.scrollTo = (() => {}) as never
  Element.prototype.scrollIntoView = (() => {}) as never
  // @tanstack/virtual-core measures the scroll element via offsetWidth/Height.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 })
})

afterEach(() => {
  cleanup()
})

// --------------- fixtures ---------------

const COMPANION: Companion = {
  id: 'comp_alice',
  name: '爱丽丝',
  identity: '化学导师',
  personalityKeywords: ['好奇']
}

const STORED_MESSAGES = [
  { id: 'm1', conversationId: 'conv_1', role: 'user', content: 'Q1 什么是卷积？', createdAt: '2026-07-06T09:00:00Z' },
  { id: 'm2', conversationId: 'conv_1', role: 'assistant', content: 'A1 一种积分运算', createdAt: '2026-07-06T09:00:05Z' }
]

interface FakeChat {
  api: ChatAPI
  emitToken(sessionId: string, token: string): void
  emitEnd(sessionId: string, finishReason: string): void
  startStream: ReturnType<typeof vi.fn>
  cancelStream: ReturnType<typeof vi.fn>
}

function createFakeChat(): FakeChat {
  const tokenCbs = new Map<string, (token: string) => void>()
  const endCbs = new Map<string, (finishReason: string) => void>()
  const startStream = vi.fn(async () => 'sess-1')
  const cancelStream = vi.fn(async () => {})

  return {
    api: {
      startStream: startStream as unknown as ChatAPI['startStream'],
      cancelStream: cancelStream as unknown as ChatAPI['cancelStream'],
      onToken: ((sid: string, cb: (token: string) => void) => {
        tokenCbs.set(sid, cb)
        return () => tokenCbs.delete(sid)
      }) as ChatAPI['onToken'],
      onThinking: (() => () => {}) as ChatAPI['onThinking'],
      onError: (() => () => {}) as ChatAPI['onError'],
      onEnd: ((sid: string, cb: (finishReason: string) => void) => {
        endCbs.set(sid, cb)
        return () => endCbs.delete(sid)
      }) as ChatAPI['onEnd'],
      onUsage: (() => () => {}) as ChatAPI['onUsage']
    },
    emitToken: (sid, token) => tokenCbs.get(sid)?.(token),
    emitEnd: (sid, reason) => endCbs.get(sid)?.(reason),
    startStream,
    cancelStream
  }
}

const dataMocks = {
  getConversation: vi.fn(),
  listMessages: vi.fn(),
  truncateConversation: vi.fn(),
  deleteMessage: vi.fn(),
  sendMessage: vi.fn(),
  getPromptMessages: vi.fn(),
  todayStudyMinutes: vi.fn()
}

beforeEach(() => {
  localStorage.clear()
  // Reset per-test call history (module-level mocks are shared).
  for (const fn of Object.values(dataMocks)) fn.mockClear()
  localStorage.setItem(
    CLASSROOM_TABS_KEY,
    JSON.stringify({ tabs: [{ title: '07-06 爱丽丝', conversationId: 'conv_1', input: '' }], activeIdx: 0 })
  )

  dataMocks.getConversation.mockResolvedValue({ id: 'conv_1', title: '07-06 爱丽丝', endedAt: null })
  dataMocks.listMessages.mockResolvedValue(STORED_MESSAGES)
  dataMocks.truncateConversation.mockResolvedValue(true)
  dataMocks.deleteMessage.mockResolvedValue(true)
  dataMocks.sendMessage.mockImplementation(async (input: { role?: string; content: string }) => ({
    id: `msg_${Math.random()}`,
    conversationId: 'conv_1',
    role: input.role ?? 'user',
    content: input.content,
    createdAt: new Date().toISOString()
  }))
  dataMocks.getPromptMessages.mockResolvedValue([
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'Q1 什么是卷积？' }
  ])
  dataMocks.todayStudyMinutes.mockResolvedValue(0)

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: {
      data: {
        ...dataMocks,
        onArtifactsGenerated: vi.fn(() => () => {}),
        onConceptsUpdated: vi.fn(() => () => {})
      },
      chat: {
        getPromptMessages: dataMocks.getPromptMessages
      },
      dialog: { confirm: vi.fn().mockResolvedValue(true) }
    }
  })
})

// --------------- harness ---------------

function Harness({ chat }: { chat: FakeChat }): React.ReactElement {
  const [, force] = useState(0)
  const ref = useRef<ReturnType<typeof createChatStreamController> | null>(null)
  if (ref.current === null) {
    ref.current = createChatStreamController(chat.api, () => force((n) => n + 1))
  }
  return (
    <ClassroomView companion={COMPANION} textbook={null} chatStream={ref.current} />
  )
}

// --------------- tests ---------------

describe('ClassroomView — regenerate flow', () => {
  it('restores the conversation and shows the history', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)

    expect(await screen.findByText('Q1 什么是卷积？')).toBeTruthy()
    expect(await screen.findByText('A1 一种积分运算')).toBeTruthy()
  })

  it('sending a new message persists it exactly once and appends one bubble', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.change(screen.getByPlaceholderText(/输入你的问题/), {
      target: { value: 'Q2 新问题' }
    })
    fireEvent.click(screen.getByText('发送'))

    await waitFor(() => expect(chat.startStream).toHaveBeenCalled())
    const userPersists = dataMocks.sendMessage.mock.calls.filter(
      (c) => (c[0] as { role?: string }).role === 'user'
    )
    expect(userPersists).toHaveLength(1)
    expect((userPersists[0][0] as { content: string }).content).toBe('Q2 新问题')
    expect(screen.getAllByText('Q2 新问题')).toHaveLength(1)

    // The streamed answer lands once, as an assistant message.
    chat.emitToken('sess-1', 'A2 新回答')
    chat.emitEnd('sess-1', 'stop')
    expect(await screen.findByText('A2 新回答')).toBeTruthy()

    const assistantPersists = dataMocks.sendMessage.mock.calls.filter(
      (c) => (c[0] as { role?: string }).role === 'assistant'
    )
    expect(assistantPersists).toHaveLength(1)
  })

  it('regenerate truncates through the user turn and does not re-persist it', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)

    await screen.findByText('A1 一种积分运算')
    fireEvent.click(screen.getAllByLabelText('重新生成回复')[0])

    // Truncate keeps the user message (m1) and drops the assistant reply.
    await waitFor(() => {
      expect(dataMocks.truncateConversation).toHaveBeenCalledWith('conv_1', 'm1')
    })

    // The user message is NOT persisted a second time.
    await waitFor(() => {
      expect(chat.startStream).toHaveBeenCalled()
    })
    const userPersists = dataMocks.sendMessage.mock.calls.filter(
      (c) => (c[0] as { role?: string }).role === 'user'
    )
    expect(userPersists).toHaveLength(0)

    // Exactly one copy of the user turn remains in the UI.
    expect(screen.getAllByText('Q1 什么是卷积？')).toHaveLength(1)

    // Stream a fresh reply: it is persisted once as the assistant message.
    chat.emitToken('sess-1', 'A2 重新生成的回答')
    chat.emitEnd('sess-1', 'stop')

    expect(await screen.findByText('A2 重新生成的回答')).toBeTruthy()
    const assistantPersists = dataMocks.sendMessage.mock.calls.filter(
      (c) => (c[0] as { role?: string }).role === 'assistant'
    )
    expect(assistantPersists).toHaveLength(1)
    expect((assistantPersists[0][0] as { content: string }).content).toBe('A2 重新生成的回答')
  })
})
