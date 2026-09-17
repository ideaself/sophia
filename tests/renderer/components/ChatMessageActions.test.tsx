// @vitest-environment jsdom
/**
 * ChatMessage — actions (copy/speak), event cards, quiz cards and the
 * edit keyboard shortcuts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

// The TTS store samples support once at module load, so the stubs must exist
// before the component module is imported (vi.hoisted runs first).
const tts = vi.hoisted(() => {
  const synth = {
    speaking: false,
    paused: false,
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  }
  class FakeUtterance {
    text: string
    lang = ''
    rate = 1
    pitch = 1
    onend?: () => void
    onerror?: () => void
    constructor(text: string) {
      this.text = text
    }
  }
  const g = globalThis as Record<string, unknown>
  g['SpeechSynthesisUtterance'] = FakeUtterance
  g['speechSynthesis'] = synth
  return { synth }
})

import { ChatMessage } from '../../../src/renderer/src/chat/ChatMessage'

beforeEach(() => {
  tts.synth.speaking = false
  tts.synth.paused = false
  tts.synth.speak.mockReset()
  tts.synth.cancel.mockReset()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) }
  })
})

afterEach(() => {
  cleanup()
})

describe('ChatMessage — copy action', () => {
  it('copies the raw content and shows, then clears, the copied state', async () => {
    render(<ChatMessage id="m1" role="assistant" content="**加粗**的内容" showActions />)

    fireEvent.click(screen.getByLabelText('复制消息内容'))

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('**加粗**的内容'))
    expect(await screen.findByText('已复制')).toBeTruthy()

    // Reverts after the 1.5s confirmation window (generous timeout: the
    // suite runs files in parallel and the timer may slip under load).
    await waitFor(() => expect(screen.queryByText('已复制')).toBeNull(), { timeout: 6000 })
  })

  it('stays silent when the clipboard rejects', async () => {
    ;(navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('denied')
    )
    render(<ChatMessage id="m1" role="user" content="hi" showActions />)

    fireEvent.click(screen.getByLabelText('复制消息内容'))

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText('已复制')).toBeNull()
  })
})

describe('ChatMessage — speak action', () => {
  it('speaks the stripped text and stops on the second click', async () => {
    tts.synth.speak.mockImplementation(() => {
      tts.synth.speaking = true
    })
    render(<ChatMessage id="a1" role="assistant" content="**熵**是状态函数。" showActions />)

    fireEvent.click(screen.getByLabelText('朗读'))
    expect(tts.synth.speak).toHaveBeenCalledTimes(1)
    const utterance = tts.synth.speak.mock.calls[0][0] as { text: string }
    expect(utterance.text).toBe('熵是状态函数。')

    // speak() marks the store as speaking → the button flips to stop (the TTS
    // panel adds a second stop button, so match all).
    await waitFor(() =>
      expect(screen.getAllByLabelText('停止朗读').length).toBeGreaterThan(0)
    )
    tts.synth.cancel.mockImplementation(() => {
      tts.synth.speaking = true
    })
    // The TTS panel adds its own stop button; click the message's one.
    fireEvent.click(screen.getAllByLabelText('停止朗读')[0])
    expect(tts.synth.cancel).toHaveBeenCalled()
  })

  it('hides the speak button without speech support', async () => {
    const g = globalThis as Record<string, unknown>
    delete g['speechSynthesis']
    delete g['SpeechSynthesisUtterance']
    vi.resetModules()

    const fresh = await import('../../../src/renderer/src/chat/ChatMessage')
    render(<fresh.ChatMessage id="a1" role="assistant" content="hi" showActions />)

    expect(screen.queryByLabelText('朗读')).toBeNull()
    expect(screen.getByLabelText('复制消息内容')).toBeTruthy()
  })
})

describe('ChatMessage — structured content', () => {
  it('renders an event card when the message opens with a hint marker', async () => {
    render(
      <ChatMessage
        id="a1"
        role="assistant"
        content={'> 💡 提示：检查量纲再计算\n\n其余正文照常渲染。'}
      />
    )

    expect(await screen.findByText('💡 导师提示')).toBeTruthy()
    expect(screen.getAllByText(/检查量纲再计算/).length).toBeGreaterThan(0)
  })

  it('renders quiz cards with the intro text preserved', async () => {
    const content = [
      '前面聊了熵的定义。',
      '',
      '**自测 1：什么是熵？**',
      '- 提示 1：与无序度有关',
      '- 答案：状态函数的度量'
    ].join('\n')

    render(<ChatMessage id="a1" role="assistant" content={content} />)

    expect(await screen.findByText(/前面聊了熵的定义/)).toBeTruthy()
    expect(await screen.findByText(/什么是熵/)).toBeTruthy()
  })
})

describe('ChatMessage — edit shortcuts', () => {
  it('saves with Enter and cancels with Escape', () => {
    const onEdit = vi.fn()
    render(<ChatMessage id="m1" role="user" content="旧内容" showActions onEdit={onEdit} />)

    // Enter saves.
    fireEvent.click(screen.getByLabelText('编辑消息'))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '回车保存' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledWith('m1', '回车保存')

    // Shift+Enter must not save.
    onEdit.mockClear()
    fireEvent.click(screen.getByLabelText('编辑消息'))
    const again = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(again, { target: { value: '换行' } })
    fireEvent.keyDown(again, { key: 'Enter', shiftKey: true })
    expect(onEdit).not.toHaveBeenCalled()

    // Escape discards the edit.
    fireEvent.keyDown(again, { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(onEdit).not.toHaveBeenCalled()
  })
})
