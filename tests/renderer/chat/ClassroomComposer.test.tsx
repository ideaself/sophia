// @vitest-environment jsdom
/**
 * ClassroomComposer — quick actions, voice triggers, panels and the send button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createRef } from 'react'

import { ClassroomComposer } from '../../../src/renderer/src/chat/ClassroomComposer'

type ComposerProps = Parameters<typeof ClassroomComposer>[0]

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

function composerProps(overrides: Partial<ComposerProps> = {}): ComposerProps {
  return {
    input: '',
    inputRef: createRef<HTMLTextAreaElement>(),
    companionAvailable: true,
    isStreaming: false,
    sending: false,
    aiAnswering: false,
    mathOpen: false,
    mathTab: 'greek',
    mathRef: createRef<HTMLDivElement>(),
    templateOpen: false,
    templateRef: createRef<HTMLDivElement>(),
    onInputChange: vi.fn(),
    onRequestSend: vi.fn(),
    onCancel: vi.fn(),
    onAiAnswer: vi.fn(),
    onToggleMath: vi.fn(),
    onSelectMathTab: vi.fn(),
    onToggleTemplate: vi.fn(),
    onCloseTemplate: vi.fn(),
    onTemplateInsert: vi.fn(),
    onInsertText: vi.fn(),
    onQuickAction: vi.fn(),
    ...overrides
  }
}

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const props = composerProps(overrides)
  render(<ClassroomComposer {...props} />)
  return props
}

describe('ClassroomComposer', () => {
  it('sends quick actions with their preset prompts', () => {
    const props = renderComposer()

    fireEvent.click(screen.getByText('给我提示'))
    expect(props.onQuickAction).toHaveBeenCalledWith(expect.stringContaining('💡 提示'))
  })

  it('disables quick actions while streaming', () => {
    renderComposer({ isStreaming: true })
    expect((screen.getByText('考考我') as HTMLButtonElement).disabled).toBe(true)
  })

  it('reports typing and sends on Enter (not Shift+Enter)', () => {
    const props = renderComposer()
    const textarea = screen.getByPlaceholderText(/输入你的问题/)

    fireEvent.change(textarea, { target: { value: '你好' } })
    expect(props.onInputChange).toHaveBeenCalledWith('你好')

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(props.onRequestSend).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(props.onRequestSend).toHaveBeenCalledTimes(1)
  })

  it('sends when the voice trigger phrase ends the input, stripping it', () => {
    const props = renderComposer()
    const textarea = screen.getByPlaceholderText(/输入你的问题/)

    fireEvent.change(textarea, { target: { value: '这是问题发送' } })

    expect(props.onInputChange).toHaveBeenCalledWith('这是问题')
    expect(props.onRequestSend).toHaveBeenCalledTimes(1)
  })

  it('clears the whole input when the clear trigger phrase ends it', () => {
    const props = renderComposer()
    const textarea = screen.getByPlaceholderText(/输入你的问题/)

    fireEvent.change(textarea, { target: { value: '写了一半清空' } })

    expect(props.onInputChange).toHaveBeenCalledWith('')
    expect(props.onRequestSend).not.toHaveBeenCalled()
  })

  it('does not send when the trigger phrase leaves only whitespace', () => {
    const props = renderComposer()
    const textarea = screen.getByPlaceholderText(/输入你的问题/)

    fireEvent.change(textarea, { target: { value: '   发送' } })

    expect(props.onInputChange).toHaveBeenCalledWith('')
    expect(props.onRequestSend).not.toHaveBeenCalled()
  })

  it('disables send for empty input and while sending', () => {
    const props = renderComposer()
    expect((screen.getByText('发送') as HTMLButtonElement).disabled).toBe(true)

    cleanup()
    render(<ClassroomComposer {...props} input="hi" sending />)
    expect((screen.getByText('发送中...') as HTMLButtonElement).disabled).toBe(true)
  })

  it('swaps send for stop while streaming and cancels on click', () => {
    const props = renderComposer({ isStreaming: true })
    fireEvent.click(screen.getByText('停止'))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('toggles the math panel and inserts symbols from the open panel', () => {
    const props = renderComposer()
    fireEvent.click(screen.getByText('Σ'))
    expect(props.onToggleMath).toHaveBeenCalled()

    cleanup()
    const openProps = renderComposer({ mathOpen: true })
    fireEvent.click(screen.getByTitle('α'))
    expect(openProps.onInsertText).toHaveBeenCalledWith('α')
  })

  it('opens the template panel and inserts a saved template', () => {
    const props = renderComposer()
    fireEvent.click(screen.getByText('☰'))
    expect(props.onToggleTemplate).toHaveBeenCalled()

    cleanup()
    localStorage.setItem('sophia.textTemplates', JSON.stringify(['模板一']))
    const openProps = renderComposer({ templateOpen: true })
    fireEvent.click(screen.getByText('模板一'))
    expect(openProps.onTemplateInsert).toHaveBeenCalledWith('模板一')
  })
})
