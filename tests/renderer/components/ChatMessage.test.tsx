// @vitest-environment jsdom
/**
 * ChatMessage component tests — the first component-level tests.
 *
 * The lazy MarkdownRenderer is mocked: these tests cover the component's
 * own logic (rendering, action gating, edit flow, notices), not the
 * markdown stack (that has its own pure-logic tests).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// Keep the test light and deterministic — mock the lazy markdown renderer.
vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

import { ChatMessage } from '../../../src/renderer/src/chat/ChatMessage'

afterEach(() => {
  cleanup()
})

describe('ChatMessage (user)', () => {
  it('renders the message content', async () => {
    render(<ChatMessage id="m1" role="user" content="你好，世界" />)
    // MarkdownRenderer is lazy — wait for the suspended tree to resolve.
    expect(await screen.findByText('你好，世界')).toBeTruthy()
  })

  it('hides actions by default and shows them when enabled', () => {
    const { rerender } = render(
      <ChatMessage id="m1" role="user" content="hi" showActions={false} onEdit={() => {}} onDelete={() => {}} />
    )
    expect(screen.queryByLabelText('编辑消息')).toBeNull()

    rerender(
      <ChatMessage id="m1" role="user" content="hi" showActions onEdit={() => {}} onDelete={() => {}} />
    )
    expect(screen.getByLabelText('编辑消息')).toBeTruthy()
    expect(screen.getByLabelText('删除消息')).toBeTruthy()
  })

  it('edits via the inline editor and reports the new content', () => {
    const onEdit = vi.fn()
    render(<ChatMessage id="m1" role="user" content="旧内容" showActions onEdit={onEdit} />)

    fireEvent.click(screen.getByLabelText('编辑消息'))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '新内容' } })
    fireEvent.click(screen.getByText('保存'))

    expect(onEdit).toHaveBeenCalledWith('m1', '新内容')
  })

  it('does not report unchanged or empty edits', () => {
    const onEdit = vi.fn()
    render(<ChatMessage id="m1" role="user" content="same" showActions onEdit={onEdit} />)

    fireEvent.click(screen.getByLabelText('编辑消息'))
    fireEvent.click(screen.getByText('保存'))

    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('ChatMessage (assistant)', () => {
  it('shows the grounding notice when flagged', () => {
    render(
      <ChatMessage id="a1" role="assistant" content="某段回答" showGroundingNotice />
    )
    expect(screen.getByText(/未引用教材出处/)).toBeTruthy()
  })

  it('renders a formatted timestamp when createdAt is given', () => {
    render(
      <ChatMessage
        id="a1"
        role="assistant"
        content="hi"
        createdAt="2026-07-06T09:05:00.000Z"
      />
    )
    // locale-dependent HH:mm — just assert that some time label rendered.
    expect(screen.getByText(/\d{2}:\d{2}/)).toBeTruthy()
  })

  it('does not offer regenerate on user messages', () => {
    const onRegenerate = vi.fn()
    render(
      <ChatMessage id="m1" role="user" content="hi" showActions onRegenerate={onRegenerate} />
    )
    expect(screen.queryByLabelText('重新生成回复')).toBeNull()
  })
})
