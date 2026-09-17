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
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { useRef, useState } from 'react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

vi.mock('../../../src/renderer/src/reader/PdfReaderView', () => ({
  PdfReaderView: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="pdf-reader">
      <button onClick={onClose}>关闭阅读器</button>
    </div>
  )
}))

vi.mock('../../../src/renderer/src/reader/EpubReaderView', () => ({
  EpubReaderView: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="epub-reader">
      <button onClick={onClose}>关闭阅读器</button>
    </div>
  )
}))

import { ClassroomView } from '../../../src/renderer/src/chat/ClassroomView'
import { useAppStore } from '../../../src/renderer/src/stores/useAppStore'
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
  id: 'comp_landau',
  name: '朗道',
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
  todayStudyMinutes: vi.fn(),
  updateTitle: vi.fn(),
  updateMessage: vi.fn(),
  endConversation: vi.fn(),
  redoArtifacts: vi.fn(),
  captureScreenshot: vi.fn(),
  composeAiAnswer: vi.fn(),
  updateTextbookProgress: vi.fn()
}

const dialogMocks = {
  confirm: vi.fn(async () => true),
  saveFile: vi.fn(async () => ({ canceled: false, filePath: 'C:\\shot.png' }))
}

let artifactsCb:
  | ((p: { conversationId: string; artifacts: number; farewell: string; failures: string[]; error?: string }) => void)
  | null = null

beforeEach(() => {
  localStorage.clear()
  // Reset per-test call history (module-level mocks are shared).
  for (const fn of Object.values(dataMocks)) fn.mockClear()
  dialogMocks.confirm.mockClear().mockResolvedValue(true)
  dialogMocks.saveFile.mockClear().mockResolvedValue({ canceled: false, filePath: 'C:\\shot.png' })
  artifactsCb = null
  localStorage.setItem(
    CLASSROOM_TABS_KEY,
    JSON.stringify({ tabs: [{ title: '07-06 朗道', conversationId: 'conv_1', input: '' }], activeIdx: 0 })
  )

  dataMocks.getConversation.mockResolvedValue({ id: 'conv_1', title: '07-06 朗道', endedAt: null })
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
  dataMocks.updateTitle.mockResolvedValue({ id: 'conv_1', title: '新名字' })
  dataMocks.updateMessage.mockResolvedValue({ id: 'm1' })
  dataMocks.endConversation.mockResolvedValue({
    success: true,
    artifacts: 0,
    farewell: '',
    failures: [],
    pending: true
  })
  dataMocks.redoArtifacts.mockResolvedValue({ success: true, artifacts: 2, failures: [] })
  dataMocks.captureScreenshot.mockResolvedValue(true)
  dataMocks.composeAiAnswer.mockResolvedValue({ content: '示范回答' })
  dataMocks.updateTextbookProgress.mockResolvedValue(null)

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: {
      data: {
        ...dataMocks,
        onArtifactsGenerated: vi.fn((cb: typeof artifactsCb) => {
          artifactsCb = cb
          return () => {
            artifactsCb = null
          }
        }),
        onConceptsUpdated: vi.fn(() => () => {})
      },
      chat: {
        getPromptMessages: dataMocks.getPromptMessages
      },
      dialog: dialogMocks
    }
  })
})

// --------------- harness ---------------

function Harness({
  chat,
  companion = COMPANION,
  textbook = null,
  loadConversationId = null,
  freshStartNonce = 0,
  onConversationLoaded
}: {
  chat: FakeChat
  companion?: Companion | null
  textbook?: { id: string; title: string; format?: string; originalFile?: string } | null
  loadConversationId?: string | null
  freshStartNonce?: number
  onConversationLoaded?: () => void
}): React.ReactElement {
  const [, force] = useState(0)
  const ref = useRef<ReturnType<typeof createChatStreamController> | null>(null)
  if (ref.current === null) {
    ref.current = createChatStreamController(chat.api, () => force((n) => n + 1))
  }
  return (
    <ClassroomView
      companion={companion}
      textbook={textbook}
      chatStream={ref.current}
      loadConversationId={loadConversationId}
      freshStartNonce={freshStartNonce}
      onConversationLoaded={onConversationLoaded}
    />
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

// --------------- tabs, shortcuts and panel flows ---------------

describe('ClassroomView — tabs and shortcuts', () => {
  it('opens, isolates and closes tabs via keyboard', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    // Ctrl+T opens a fresh tab; typing stays in that tab's draft.
    fireEvent.keyDown(window, { key: 't', ctrlKey: true })
    const composer = screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: '新标签草稿' } })
    expect(composer.value).toBe('新标签草稿')

    // Ctrl+Tab wraps back to the first tab (empty draft).
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true })
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement).value).toBe('')
    )

    // Ctrl+Shift+W closes the active tab; the drafted tab survives.
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(screen.queryByText('07-06 朗道')).toBeNull())
    expect((screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement).value).toBe('新标签草稿')
  })

  it('ignores tab shortcuts while typing in the composer', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    const composer = screen.getByPlaceholderText(/输入你的问题/)
    fireEvent.keyDown(composer, { key: 't', ctrlKey: true })
    expect(screen.queryByText('新对话')).toBeNull()
  })

  it('searches the conversation with Ctrl+F and closes with Escape', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    const searchInput = await screen.findByPlaceholderText('搜索本对话...')

    fireEvent.change(searchInput, { target: { value: 'Q1' } })
    await screen.findByText('1/1')

    fireEvent.change(searchInput, { target: { value: '1' } })
    await screen.findByText('1/2')

    fireEvent.keyDown(searchInput, { key: 'Enter' })
    await screen.findByText('2/2')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByPlaceholderText('搜索本对话...')).toBeNull())
  })

  it('toggles the shortcut sheet with Ctrl+/', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Ctrl + T')).toBeTruthy()

    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('inserts a saved text template with Alt+1', async () => {
    localStorage.setItem('sophia.textTemplates', JSON.stringify(['模板一号', '模板二号']))
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.keyDown(window, { key: '1', altKey: true })
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement).value).toBe(
        '模板一号'
      )
    )
  })

  it('drafts an AI answer with Ctrl+Shift+A', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true, shiftKey: true })

    await waitFor(() => expect(dataMocks.composeAiAnswer).toHaveBeenCalled())
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement).value).toBe(
        '示范回答'
      )
    )
  })
})

describe('ClassroomView — header and end-class flows', () => {
  it('renames the conversation from the header', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByTitle('点击重命名'))
    const input = await screen.findByDisplayValue('07-06 朗道')
    fireEvent.change(input, { target: { value: '新名字' } })
    // The header may re-render while editing; act on the live node.
    const liveInput = await screen.findByDisplayValue('新名字')
    fireEvent.keyDown(liveInput, { key: 'Enter' })

    await waitFor(() => expect(dataMocks.updateTitle).toHaveBeenCalledWith('conv_1', '新名字'))
  })

  it('captures a screenshot through the save dialog', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByTitle('截图当前课堂窗口并保存为图片'))

    await waitFor(() =>
      expect(dataMocks.captureScreenshot).toHaveBeenCalledWith('C:\\shot.png')
    )
  })

  it('opens the reader split for a textbook with an original file', async () => {
    const chat = createFakeChat()
    render(
      <Harness
        chat={chat}
        textbook={{ id: 'tb_1', title: '物理讲义', format: 'pdf', originalFile: 'x.pdf' }}
      />
    )
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByText(/教材阅读/))
    expect(await screen.findByTestId('pdf-reader')).toBeTruthy()
  })

  it('ends the class and updates the end card when artifacts arrive', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByText('下课'))

    await waitFor(() => expect(dataMocks.endConversation).toHaveBeenCalledWith('conv_1', 'standard'))
    await screen.findByText('课程已结束')
    expect(screen.getByText(/学习摘要后台生成中/)).toBeTruthy()

    act(() => {
      artifactsCb?.({ conversationId: 'conv_1', artifacts: 3, farewell: '下节课见', failures: [] })
    })

    await screen.findByText('下节课见')
    expect(screen.getByText(/已自动生成 3 个学习摘要/)).toBeTruthy()
  })

  it('offers to redo missing artifacts after a partially failed end', async () => {
    dataMocks.endConversation.mockResolvedValue({
      success: true,
      artifacts: 2,
      farewell: '',
      failures: ['flashcards'],
      pending: false
    })
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByText('下课'))
    await screen.findByText(/1 项学习摘要生成失败/)

    fireEvent.click(screen.getByText('补齐缺失产物'))
    await waitFor(() =>
      expect(dataMocks.redoArtifacts).toHaveBeenCalledWith('conv_1', ['flashcards'])
    )
  })
})

describe('ClassroomView — message actions', () => {
  it('rewinds the conversation to a message after confirmation', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getAllByLabelText('从这里重新开始')[0])

    await waitFor(() => expect(dataMocks.truncateConversation).toHaveBeenCalledWith('conv_1', 'm1'))
    await waitFor(() => expect(screen.queryByText('A1 一种积分运算')).toBeNull())
  })

  it('edits and deletes a message', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getAllByLabelText('编辑消息')[0])
    const editor = await screen.findByDisplayValue('Q1 什么是卷积？')
    fireEvent.change(editor, { target: { value: 'Q1 修改后的问题' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(dataMocks.updateMessage).toHaveBeenCalledWith('conv_1', 'm1', 'Q1 修改后的问题')
    )
    await screen.findByText('Q1 修改后的问题')

    fireEvent.click(screen.getAllByLabelText('删除消息')[0])
    await waitFor(() => expect(dataMocks.deleteMessage).toHaveBeenCalledWith('conv_1', 'm1'))
    await waitFor(() => expect(screen.queryByText('Q1 修改后的问题')).toBeNull())
  })
})

describe('ClassroomView — tab lifecycle', () => {
  it('cancels an active stream when the companion changes', async () => {
    const chat = createFakeChat()
    const { rerender } = render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.change(screen.getByPlaceholderText(/输入你的问题/), { target: { value: '新问题' } })
    fireEvent.click(screen.getByText('发送'))
    await waitFor(() => expect(chat.startStream).toHaveBeenCalled())

    rerender(<Harness chat={chat} companion={{ ...COMPANION, id: 'comp_other', name: '祖冲之' }} />)
    await waitFor(() => expect(chat.cancelStream).toHaveBeenCalled())
  })

  it('starts fresh when freshStartNonce is set', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} freshStartNonce={1} />)

    expect(screen.queryByText('07-06 朗道')).toBeNull()
    expect((screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement).value).toBe('')
  })

  it('loads a conversation from history into a new tab', async () => {
    dataMocks.getConversation.mockImplementation(async (id: string) => ({
      id,
      title: id === 'conv_2' ? '历史课' : '07-06 朗道',
      endedAt: null
    }))
    dataMocks.listMessages.mockResolvedValue([
      { id: 'h1', conversationId: 'conv_2', role: 'user', content: '历史消息一', createdAt: '2026-07-01T10:00:00Z' }
    ])
    const onLoaded = vi.fn()
    render(<Harness chat={createFakeChat()} loadConversationId="conv_2" onConversationLoaded={onLoaded} />)

    await screen.findByText('历史消息一')
    expect(onLoaded).toHaveBeenCalled()
  })

  it('drops hydrated tabs whose conversation no longer exists', async () => {
    dataMocks.getConversation.mockResolvedValue(null)
    render(<Harness chat={createFakeChat()} />)

    await waitFor(() => expect(screen.queryByText('07-06 朗道')).toBeNull())
    expect(screen.getAllByText('新对话').length).toBeGreaterThan(0)
  })
})

describe('ClassroomView — remaining branches', () => {
  it('reacts to the daily-goal event and flushes the draft on unmount', async () => {
    const chat = createFakeChat()
    const { unmount } = render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    localStorage.setItem('sophia.dailyGoal', '45')
    act(() => {
      window.dispatchEvent(new Event('sophia:goal-changed'))
    })
    expect(await screen.findByTitle(/\/45 分钟/)).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText(/输入你的问题/), { target: { value: '未发送草稿' } })
    unmount()

    const saved = JSON.parse(localStorage.getItem(CLASSROOM_TABS_KEY) ?? '{}') as {
      tabs: Array<{ input: string }>
    }
    expect(saved.tabs[0]?.input).toBe('未发送草稿')
  })

  it('activates an already-open tab for loadConversationId', async () => {
    const chat = createFakeChat()
    const onLoaded = vi.fn()
    render(<Harness chat={chat} loadConversationId="conv_1" onConversationLoaded={onLoaded} />)
    await screen.findByText('A1 一种积分运算')

    await waitFor(() => expect(onLoaded).toHaveBeenCalled())
    // No duplicate tab is created for the already-restored conversation.
    expect(screen.queryByText('新对话')).toBeNull()
  })

  it('closes the math and template panels on outside clicks', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByTitle('插入数学符号 / 公式 (Σ)'))
    expect(await screen.findByText('π')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByText('π')).toBeNull())

    fireEvent.click(screen.getByTitle('插入常用文本模板'))
    expect(await screen.findByLabelText('关闭模板面板')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByLabelText('关闭模板面板')).toBeNull())
  })

  it('wraps backwards with Ctrl+Shift+Tab', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.keyDown(window, { key: 't', ctrlKey: true })
    const composer = screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: '第二标签' } })

    // From the last tab, Ctrl+Shift+Tab wraps to the first.
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true })
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement).value).toBe('')
    )

    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true })
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement).value).toBe(
        '第二标签'
      )
    )
  })

  it('creates and closes tabs from the tab bar', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    const tabCount = (): number =>
      document.querySelectorAll('[role="tablist"] > div').length
    fireEvent.click(screen.getByLabelText('新建对话'))
    await waitFor(() => expect(tabCount()).toBe(2))

    fireEvent.click(screen.getByLabelText('关闭标签 新对话'))
    await waitFor(() => expect(tabCount()).toBe(1))
  })

  it('continues learning from the end card', async () => {
    dataMocks.endConversation.mockResolvedValue({
      success: true,
      artifacts: 2,
      farewell: '再见',
      failures: [],
      pending: false
    })
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByText('下课'))
    await screen.findByText('课程已结束')

    fireEvent.click(screen.getByText('继续学习'))
    await waitFor(() =>
      expect(document.querySelectorAll('[role="tablist"] > div').length).toBe(2)
    )
  })

  it('reviews the new cards from the end card', async () => {
    dataMocks.endConversation.mockResolvedValue({
      success: true,
      artifacts: 2,
      farewell: '再见',
      failures: [],
      pending: false
    })
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByText('下课'))
    await screen.findByText('课程已结束')

    fireEvent.click(screen.getByText('复习本节新卡'))
    expect(useAppStore.getState().view).toBe('flashcards')
    expect(useAppStore.getState().flashcardScope).toMatchObject({ conversationId: 'conv_1' })
  })

  it('surfaces AI-answer failures as an error row', async () => {
    dataMocks.composeAiAnswer.mockRejectedValueOnce(new Error('model offline'))
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByTitle(/AI 代答/))

    expect(await screen.findByText('发送失败')).toBeTruthy()
    expect(screen.getByText('model offline')).toBeTruthy()
  })

  it('discards an empty rename', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByTitle('点击重命名'))
    const input = await screen.findByDisplayValue('07-06 朗道')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.queryByDisplayValue('07-06 朗道')).toBeNull())
    expect(dataMocks.updateTitle).not.toHaveBeenCalled()
  })

  it('switches pace and feynman mode from the header', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    const fast = screen.getByText('快')
    fireEvent.click(fast)
    expect(fast.className).toContain('bg-accent')

    const feynman = screen.getByTitle(/切换课堂模式/)
    fireEvent.click(feynman)
    expect(feynman.className).toContain('border-accent')
  })

  it('shows the no-companion placeholder', () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} companion={null} />)

    expect(screen.getByText('请先选择一位学习伙伴')).toBeTruthy()
  })

  it('drives the composer callbacks (math, template, AI answer, quick action)', async () => {
    dataMocks.composeAiAnswer.mockResolvedValue({ content: '示范回复' })
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    // Math and template panels are mutually exclusive.
    fireEvent.click(screen.getByTitle('插入数学符号 / 公式 (Σ)'))
    await screen.findByText('π')
    fireEvent.click(screen.getByTitle('插入常用文本模板'))
    await waitFor(() => expect(screen.queryByText('π')).toBeNull())
    fireEvent.click(screen.getByLabelText('关闭模板面板'))
    await waitFor(() => expect(screen.queryByLabelText('关闭模板面板')).toBeNull())

    // AI answer fills the draft.
    fireEvent.click(screen.getByTitle(/AI 代答/))
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement).value).toBe(
        '示范回复'
      )
    )

    // Quick actions send their preset prompt.
    fireEvent.click(screen.getByText('继续追问'))
    await waitFor(() =>
      expect(dataMocks.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('继续追问') })
      )
    )
  })
})

describe('ClassroomView — remaining handlers', () => {
  it('debounces the draft save while typing', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.change(screen.getByPlaceholderText(/输入你的问题/), { target: { value: '慢慢写的草稿' } })

    await waitFor(
      () => {
        const saved = JSON.parse(localStorage.getItem(CLASSROOM_TABS_KEY) ?? '{}') as {
          tabs: Array<{ input: string }>
        }
        expect(saved.tabs[0]?.input).toBe('慢慢写的草稿')
      },
      { timeout: 2000 }
    )
  })

  it('renders the streaming bubble while a reply is arriving', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.change(screen.getByPlaceholderText(/输入你的问题/), { target: { value: '新问题' } })
    fireEvent.click(screen.getByText('发送'))
    await waitFor(() => expect(chat.startStream).toHaveBeenCalled())

    chat.emitToken('sess-1', '正在生成')
    expect(await screen.findByText('正在生成')).toBeTruthy()

    chat.emitEnd('sess-1', 'stop')
    await screen.findByText('正在生成')
  })

  it('cancels title editing with Escape from the header input', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByTitle('点击重命名'))
    const input = await screen.findByDisplayValue('07-06 朗道')
    fireEvent.keyDown(input, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByDisplayValue('07-06 朗道')).toBeNull())
    expect(dataMocks.updateTitle).not.toHaveBeenCalled()
  })

  it('retries a failed turn through the error row', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.change(screen.getByPlaceholderText(/输入你的问题/), { target: { value: '会失败的问题' } })
    fireEvent.click(screen.getByText('发送'))
    await waitFor(() => expect(chat.startStream).toHaveBeenCalled())

    // A partial (interrupted) reply flags the turn for retry.
    chat.emitToken('sess-1', '半截回答')
    chat.emitEnd('sess-1', 'error:timeout')
    await screen.findByText('发送失败')

    chat.startStream.mockClear()
    fireEvent.click(screen.getByText('重试'))
    await waitFor(() => expect(chat.startStream).toHaveBeenCalled())
  })

  it('cancels an in-flight stream from the composer', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.change(screen.getByPlaceholderText(/输入你的问题/), { target: { value: '打断它' } })
    fireEvent.click(screen.getByText('发送'))
    await waitFor(() => expect(chat.startStream).toHaveBeenCalled())

    fireEvent.click(await screen.findByText('停止'))
    await waitFor(() => expect(chat.cancelStream).toHaveBeenCalled())
  })

  it('inserts a saved template from the panel', async () => {
    localStorage.setItem('sophia.textTemplates', JSON.stringify(['请给一个例子']))
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByTitle('插入常用文本模板'))
    fireEvent.click(await screen.findByText(/请给一个例子/))

    await waitFor(() =>
      expect((screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement).value).toBe(
        '请给一个例子'
      )
    )
  })

  it('closes the embedded reader from the reader itself', async () => {
    const chat = createFakeChat()
    const { unmount } = render(
      <Harness
        chat={chat}
        textbook={{ id: 'tb_1', title: '物理讲义', format: 'pdf', originalFile: 'x.pdf' }}
      />
    )
    await screen.findByText('A1 一种积分运算')
    fireEvent.click(screen.getByText(/教材阅读/))
    fireEvent.click(await screen.findByText('关闭阅读器'))
    await waitFor(() => expect(screen.queryByTestId('pdf-reader')).toBeNull())
    unmount()

    const epubChat = createFakeChat()
    render(
      <Harness
        chat={epubChat}
        textbook={{ id: 'tb_2', title: '化学讲义', format: 'epub', originalFile: 'y.epub' }}
      />
    )
    await screen.findByText('A1 一种积分运算')
    fireEvent.click(screen.getByText(/教材阅读/))
    fireEvent.click(await screen.findByText('关闭阅读器'))
    await waitFor(() => expect(screen.queryByTestId('epub-reader')).toBeNull())
  })

  it('closes the shortcut sheet from its button', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByText('关闭 (Esc)'))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('ClassroomView — guard branches', () => {
  function freshTab(): void {
    localStorage.setItem(
      CLASSROOM_TABS_KEY,
      JSON.stringify({ tabs: [{ title: '新课堂', conversationId: null, input: '' }], activeIdx: 0 })
    )
  }

  it('ignores tab shortcuts when only one tab is open', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.keyDown(window, { key: 'w', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true })

    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1))
    expect(screen.getByText('A1 一种积分运算')).toBeTruthy()
  })

  it('ignores Alt+N templates that are unsaved or out of range', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    const input = screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement
    fireEvent.keyDown(window, { key: '1', altKey: true }) // no snippets saved
    fireEvent.keyDown(window, { key: '0', altKey: true }) // out of range
    fireEvent.keyDown(window, { key: '9', altKey: true }) // out of range

    expect(input.value).toBe('')
  })

  it('does nothing when ending a class without a conversation', async () => {
    freshTab()
    const chat = createFakeChat()
    render(<Harness chat={chat} />)

    // A fresh tab has no header controls at all — nothing to click.
    expect(screen.queryByText('下课')).toBeNull()
    expect(dialogMocks.confirm).not.toHaveBeenCalled()
    expect(dataMocks.endConversation).not.toHaveBeenCalled()
  })

  it('keeps the class running when the end-class confirmation is declined', async () => {
    dialogMocks.confirm.mockResolvedValue(false)
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByText('下课'))

    await waitFor(() => expect(dialogMocks.confirm).toHaveBeenCalled())
    expect(dataMocks.endConversation).not.toHaveBeenCalled()
    expect(screen.getByText('A1 一种积分运算')).toBeTruthy()
  })

  it('skips the screenshot when the save dialog is cancelled', async () => {
    dialogMocks.saveFile.mockResolvedValue({ canceled: true, filePath: '' })
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByTitle('截图当前课堂窗口并保存为图片'))

    await waitFor(() => expect(dialogMocks.saveFile).toHaveBeenCalled())
    expect(dataMocks.captureScreenshot).not.toHaveBeenCalled()
  })

  it('skips the AI draft without a companion', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} companion={null} />)
    await screen.findByText('请先选择一位学习伙伴')

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'A', ctrlKey: true, shiftKey: true })

    expect(dataMocks.composeAiAnswer).not.toHaveBeenCalled()
  })

  it('keeps the conversation when the rewind confirmation is declined', async () => {
    dialogMocks.confirm.mockResolvedValue(false)
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getAllByLabelText('从这里重新开始')[0])

    await waitFor(() => expect(dialogMocks.confirm).toHaveBeenCalled())
    expect(dataMocks.truncateConversation).not.toHaveBeenCalled()
    expect(screen.getByText('A1 一种积分运算')).toBeTruthy()
  })

  it('ignores artifact events addressed to another conversation', async () => {
    const chat = createFakeChat()
    render(<Harness chat={chat} />)
    await screen.findByText('A1 一种积分运算')

    fireEvent.click(screen.getByText('下课'))
    await screen.findByText('课程已结束')

    act(() => {
      artifactsCb?.({ conversationId: 'other_conv', artifacts: 5, farewell: '别的课', failures: [] })
    })
    expect(screen.queryByText('别的课')).toBeNull()

    act(() => {
      artifactsCb?.({ conversationId: 'conv_1', artifacts: 3, farewell: '下节课见', failures: [] })
    })
    expect(await screen.findByText('下节课见')).toBeTruthy()
  })

  it('stops loading a history conversation after unmount', async () => {
    function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
      let resolve!: (value: T) => void
      const promise = new Promise<T>((res) => {
        resolve = res
      })
      return { promise, resolve }
    }

    // Phase 1: unmount before the conversation lookup resolves.
    const convGate = deferred<{ id: string; title: string; endedAt: null }>()
    dataMocks.getConversation.mockImplementation(async (id: string) =>
      id === 'conv_hist' ? convGate.promise : { id, title: 't', endedAt: null }
    )
    const first = render(<Harness chat={createFakeChat()} loadConversationId="conv_hist" />)
    await waitFor(() => expect(dataMocks.getConversation).toHaveBeenCalledWith('conv_hist'))
    first.unmount()
    convGate.resolve({ id: 'conv_hist', title: '历史课', endedAt: null })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Phase 2: unmount while the messages are still loading.
    const msgsGate = deferred<typeof STORED_MESSAGES>()
    dataMocks.getConversation.mockImplementation(async (id: string) => ({
      id,
      title: '历史课',
      endedAt: null
    }))
    dataMocks.listMessages.mockImplementation(async (id: string) =>
      id === 'conv_hist' ? msgsGate.promise : STORED_MESSAGES
    )
    const second = render(<Harness chat={createFakeChat()} loadConversationId="conv_hist" />)
    await waitFor(() => expect(dataMocks.listMessages).toHaveBeenCalledWith('conv_hist'))
    second.unmount()
    msgsGate.resolve(STORED_MESSAGES)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('历史课')).toBeNull()
  })
})
