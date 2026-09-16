// @vitest-environment jsdom
/**
 * MessageList — the virtualized scroll container: empty state, message rows
 * (thinking block + ChatMessage wiring), error row and end-of-class card.
 *
 * The virtualizer needs the usual jsdom layout stubs; MarkdownRenderer is
 * mocked because the real pipeline pulls in KaTeX/highlighting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

import {
  MessageList,
  type MessageRow
} from '../../../src/renderer/src/chat/MessageList'
import { useMessageListScroll } from '../../../src/renderer/src/chat/useMessageListScroll'
import type { TabState } from '../../../src/renderer/src/chat/types'

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
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// --------------- fixtures ---------------

function messageRow(
  id: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  extra?: Partial<Extract<MessageRow, { kind: 'message' }>>
): MessageRow {
  return {
    kind: 'message',
    key: id,
    msg: { id, role, content },
    showThinking: false,
    highlight: 'none',
    ...extra
  }
}

interface HarnessProps {
  rows: MessageRow[]
  companionName?: string
  messageCount?: number
  isStreaming?: boolean
  reasoningContent?: string
  groundingFlagged?: ReadonlySet<string>
  errorMessage?: string
  onRetry?: () => void
  textbookId?: string | null
  endResult?: TabState['endResult']
  onRewind?: (id: string) => void
  onEdit?: (id: string, content: string) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  onRegenerate?: (id: string) => Promise<void>
  onReviewNewCards?: () => void
  onContinueLearning?: () => void
  onRedoArtifacts?: () => void
}

function ListHarness({
  rows,
  companionName = '朗道',
  messageCount = rows.filter((r) => r.kind === 'message').length,
  isStreaming = false,
  reasoningContent = '',
  groundingFlagged = new Set<string>(),
  errorMessage,
  onRetry,
  textbookId = null,
  endResult = null,
  onRewind = vi.fn(),
  onEdit = vi.fn(async () => {}),
  onDelete = vi.fn(async () => {}),
  onRegenerate = vi.fn(async () => {}),
  onReviewNewCards = vi.fn(),
  onContinueLearning = vi.fn(),
  onRedoArtifacts = vi.fn()
}: HarnessProps): React.ReactElement {
  const { scrollRef, handleScroll, virtualizer } = useMessageListScroll({
    rows,
    messages: [],
    streamContent: '',
    streaming: isStreaming,
    activeIdx: 0,
    searchOpen: false,
    searchMatches: [],
    matchIndex: 0
  })
  return (
    <MessageList
      scrollRef={scrollRef}
      onScroll={handleScroll}
      rows={rows}
      virtualizer={virtualizer}
      companionName={companionName}
      messageCount={messageCount}
      isStreaming={isStreaming}
      reasoningContent={reasoningContent}
      groundingFlagged={groundingFlagged}
      errorMessage={errorMessage}
      onRetry={onRetry}
      textbookId={textbookId}
      endResult={endResult}
      redoing={false}
      onRewind={onRewind}
      onEdit={onEdit}
      onDelete={onDelete}
      onRegenerate={onRegenerate}
      onReviewNewCards={onReviewNewCards}
      onContinueLearning={onContinueLearning}
      onRedoArtifacts={onRedoArtifacts}
    />
  )
}

// --------------- tests ---------------

describe('MessageList', () => {
  it('shows the empty-state hint with the companion name', () => {
    render(<ListHarness rows={[]} companionName="朗道" />)

    expect(screen.getByText(/开始和/)).toBeTruthy()
    expect(screen.getByText('朗道')).toBeTruthy()
    expect(screen.getByRole('log', { name: '课堂消息' })).toBeTruthy()
  })

  it('renders message rows from the list', async () => {
    render(
      <ListHarness
        rows={[
          messageRow('m1', 'user', 'Q1 什么是卷积？'),
          messageRow('m2', 'assistant', 'A1 一种积分运算')
        ]}
      />
    )

    expect(await screen.findByText('Q1 什么是卷积？')).toBeTruthy()
    expect(await screen.findByText('A1 一种积分运算')).toBeTruthy()
  })

  it('shows the thinking block only when the row carries reasoning', async () => {
    render(
      <ListHarness
        rows={[messageRow('m1', 'assistant', '答案', { showThinking: true })]}
        reasoningContent="先分析题目…"
        isStreaming
      />
    )

    expect(await screen.findByText('🧠 思考过程')).toBeTruthy()
    expect(await screen.findByText('先分析题目…')).toBeTruthy()
    expect(screen.getByText('(进行中...)')).toBeTruthy()
  })

  it('offers rewind on earlier messages but not on the last one', async () => {
    render(
      <ListHarness
        rows={[
          messageRow('m1', 'user', 'Q1'),
          messageRow('m2', 'assistant', 'A1'),
          messageRow('m3', 'user', 'Q2')
        ]}
      />
    )

    await screen.findByText('Q1')
    // m1/m2 can rewind; the last message (m3) cannot.
    expect(screen.getAllByLabelText('从这里重新开始')).toHaveLength(2)
    expect(screen.getAllByLabelText('编辑消息')).toHaveLength(3)
  })

  it('hides row actions while streaming', async () => {
    render(
      <ListHarness
        rows={[messageRow('m1', 'user', 'Q1'), messageRow('m2', 'assistant', 'A1')]}
        isStreaming
      />
    )

    await screen.findByText('Q1')
    expect(screen.queryByLabelText('重新生成回复')).toBeNull()
    expect(screen.queryByLabelText('编辑消息')).toBeNull()
    expect(screen.queryByLabelText('从这里重新开始')).toBeNull()
  })

  it('wires the error row retry and hides the button without a handler', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(
      <ListHarness rows={[{ kind: 'error', key: 'e' }]} errorMessage="API 超时" onRetry={onRetry} />
    )

    expect(screen.getByText('发送失败')).toBeTruthy()
    expect(screen.getByText('API 超时')).toBeTruthy()
    fireEvent.click(screen.getByText('重试'))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<ListHarness rows={[{ kind: 'error', key: 'e' }]} errorMessage="API 超时" />)
    expect(screen.queryByText('重试')).toBeNull()
  })

  it('renders the end card with its actions', () => {
    const onReviewNewCards = vi.fn()
    render(
      <ListHarness
        rows={[{ kind: 'end', key: 'end' }]}
        endResult={{
          artifacts: 3,
          farewell: '今天学得很好。',
          conversationId: 'conv_1',
          pending: false
        }}
        onReviewNewCards={onReviewNewCards}
      />
    )

    expect(screen.getByText('课程已结束')).toBeTruthy()
    expect(screen.getByText('今天学得很好。')).toBeTruthy()
    fireEvent.click(screen.getByText('复习本节新卡'))
    expect(onReviewNewCards).toHaveBeenCalledTimes(1)
  })

  it('flags answers that lack a textbook citation', async () => {
    const { rerender } = render(
      <ListHarness
        rows={[messageRow('m1', 'assistant', 'A1 未引用的回答')]}
        groundingFlagged={new Set(['m1'])}
        textbookId="tb_1"
      />
    )

    await screen.findByText('A1 未引用的回答')
    expect(screen.getByText('⚠️ 本次回答未引用教材出处，内容待核实')).toBeTruthy()

    rerender(<ListHarness rows={[messageRow('m1', 'assistant', 'A1 未引用的回答')]} textbookId="tb_1" />)
    expect(screen.queryByText('⚠️ 本次回答未引用教材出处，内容待核实')).toBeNull()
  })
})
