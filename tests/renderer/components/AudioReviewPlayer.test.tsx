// @vitest-environment jsdom
/**
 * AudioReviewPlayer — script parsing/rendering, speech playback with
 * auto-advance, pause/resume, skipping, rate control and the unsupported
 * fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { AudioReviewPlayer } from '../../../src/renderer/src/components/AudioReviewPlayer'

const SCRIPT = ['【导师】熵是什么？', '【学习者】熵是状态函数。'].join('\n')

interface FakeUtterance {
  text: string
  lang: string
  rate: number
  pitch: number
  onend?: () => void
  onerror?: () => void
}

let spoken: FakeUtterance[] = []
const synth = {
  paused: false,
  speak: vi.fn((u: FakeUtterance) => {
    spoken.push(u)
  }),
  cancel: vi.fn(() => {
    synth.paused = false
  }),
  pause: vi.fn(() => {
    synth.paused = true
  }),
  resume: vi.fn(() => {
    synth.paused = false
  })
}

beforeEach(() => {
  spoken = []
  synth.paused = false
  synth.speak.mockClear()
  synth.cancel.mockClear()
  synth.pause.mockClear()
  synth.resume.mockClear()

  class FakeSpeechSynthesisUtterance implements FakeUtterance {
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
  vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance)
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as { speechSynthesis?: unknown }).speechSynthesis
})

/** Finish the current utterance so playback advances. */
function finishUtterance(): void {
  spoken[spoken.length - 1]?.onend?.()
}

describe('AudioReviewPlayer — fallback and rendering', () => {
  it('falls back to a plain notice without speech support', () => {
    delete (window as { speechSynthesis?: unknown }).speechSynthesis
    render(<AudioReviewPlayer content={SCRIPT} />)

    expect(screen.getByText(/当前环境不支持语音合成/)).toBeTruthy()
    expect(screen.queryByText('▶️ 播放')).toBeNull()
  })

  it('renders the parsed script with speaker labels and pager', () => {
    render(<AudioReviewPlayer content={SCRIPT} />)

    expect(screen.getByText('导师')).toBeTruthy()
    expect(screen.getByText('学习者')).toBeTruthy()
    expect(screen.getByText('第 1/2 段')).toBeTruthy()
    expect(screen.getByText('熵是什么？')).toBeTruthy()
    expect(screen.getByText('熵是状态函数。')).toBeTruthy()
  })

  it('shows an empty state for script-less content', () => {
    render(<AudioReviewPlayer content="这里没有脚本行" />)

    expect(screen.getByText('无脚本')).toBeTruthy()
    expect((screen.getByText('▶️ 播放') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('⏮️ 上一段') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('AudioReviewPlayer — playback', () => {
  it('plays with per-speaker pitch and advances on line end', async () => {
    render(<AudioReviewPlayer content={SCRIPT} />)

    fireEvent.click(screen.getByText('▶️ 播放'))

    await waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(1))
    expect(spoken[0]).toMatchObject({ text: '熵是什么？', lang: 'zh-CN', pitch: 0.85, rate: 1 })
    expect(screen.getByText('⏸️ 暂停')).toBeTruthy()

    finishUtterance()
    await waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(2))
    expect(spoken[1]).toMatchObject({ text: '熵是状态函数。', pitch: 1.2 })
    expect(screen.getByText('第 2/2 段')).toBeTruthy()

    // Finishing the last line stops playback.
    finishUtterance()
    await waitFor(() => expect(screen.getByText('▶️ 播放')).toBeTruthy())
  })

  it('pauses and resumes through the speech engine', async () => {
    render(<AudioReviewPlayer content={SCRIPT} />)
    fireEvent.click(screen.getByText('▶️ 播放'))
    await waitFor(() => expect(synth.speak).toHaveBeenCalled())
    expect(screen.getByText('⏸️ 暂停')).toBeTruthy()

    fireEvent.click(screen.getByText('⏸️ 暂停'))
    expect(synth.pause).toHaveBeenCalled()
    expect(screen.getByText('▶️ 播放')).toBeTruthy()

    synth.paused = true
    fireEvent.click(screen.getByText('▶️ 播放'))
    expect(synth.resume).toHaveBeenCalled()
    expect(screen.getByText('⏸️ 暂停')).toBeTruthy()
  })

  it('skips to the next/previous line and clamps at both ends', async () => {
    render(<AudioReviewPlayer content={SCRIPT} />)

    fireEvent.click(screen.getByText('下一段 ⏭️'))
    await waitFor(() => expect(screen.getByText('第 2/2 段')).toBeTruthy())
    expect(spoken.at(-1)?.text).toBe('熵是状态函数。')

    fireEvent.click(screen.getByText('下一段 ⏭️'))
    expect(screen.getByText('第 2/2 段')).toBeTruthy()

    fireEvent.click(screen.getByText('⏮️ 上一段'))
    await waitFor(() => expect(screen.getByText('第 1/2 段')).toBeTruthy())
    expect(spoken.at(-1)?.text).toBe('熵是什么？')

    fireEvent.click(screen.getByText('⏮️ 上一段'))
    expect(screen.getByText('第 1/2 段')).toBeTruthy()
  })

  it('applies the selected playback rate to new utterances', async () => {
    render(<AudioReviewPlayer content={SCRIPT} />)

    fireEvent.click(screen.getByText('1.5x'))
    fireEvent.click(screen.getByText('▶️ 播放'))

    await waitFor(() => expect(synth.speak).toHaveBeenCalled())
    expect(spoken[0].rate).toBe(1.5)

    finishUtterance()
    await waitFor(() => expect(spoken.length).toBe(2))
    expect(spoken[1].rate).toBe(1.5)
  })

  it('cancels speech on unmount', async () => {
    const { unmount } = render(<AudioReviewPlayer content={SCRIPT} />)
    fireEvent.click(screen.getByText('▶️ 播放'))
    await waitFor(() => expect(synth.speak).toHaveBeenCalled())

    unmount()
    expect(synth.cancel).toHaveBeenCalled()
  })
})
