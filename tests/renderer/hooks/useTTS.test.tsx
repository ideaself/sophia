// @vitest-environment jsdom
/**
 * useTTS store — speak/stop/pause/resume, rate clamping, loop replay.
 *
 * `supported` is captured when the module loads, so the speechSynthesis mock
 * must be installed before the (dynamic) import.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

class FakeUtterance {
  text: string
  lang = ''
  rate = 1
  onstart: (() => void) | null = null
  onboundary: ((e: { charIndex: number }) => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

const speakSpy = vi.fn()
const cancelSpy = vi.fn()
const pauseSpy = vi.fn()
const resumeSpy = vi.fn()

vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
Object.defineProperty(window, 'speechSynthesis', {
  configurable: true,
  value: { speak: speakSpy, cancel: cancelSpy, pause: pauseSpy, resume: resumeSpy }
})

const { speakTTS, stopTTS, pauseTTS, resumeTTS, setRateTTS, setLoopTTS, getTTSState } =
  await import('../../../src/renderer/src/hooks/useTTS')

const lastUtterance = (): FakeUtterance => speakSpy.mock.calls.at(-1)?.[0] as FakeUtterance

beforeEach(() => {
  stopTTS()
  setRateTTS(1)
  setLoopTTS(false)
  // Clear AFTER the reset (stopTTS itself calls cancel()).
  speakSpy.mockClear()
  cancelSpy.mockClear()
  pauseSpy.mockClear()
  resumeSpy.mockClear()
})

describe('speakTTS', () => {
  it('cancels any ongoing speech, speaks the utterance and marks speaking', () => {
    speakTTS('你好世界', 'zh-CN')

    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(speakSpy).toHaveBeenCalledTimes(1)
    expect(lastUtterance().text).toBe('你好世界')
    expect(lastUtterance().lang).toBe('zh-CN')
    expect(getTTSState().speaking).toBe(true)
  })

  it('ignores empty or whitespace-only text', () => {
    speakTTS('   ', 'zh-CN')
    expect(speakSpy).not.toHaveBeenCalled()
  })

  it('tracks progress from boundary events and finishes on end', () => {
    speakTTS('abcdefghij', 'zh-CN')
    const utter = lastUtterance()

    utter.onboundary?.({ charIndex: 5 })
    expect(getTTSState().progress).toBeCloseTo(0.5)

    utter.onend?.()
    expect(getTTSState().speaking).toBe(false)
    expect(getTTSState().progress).toBe(1)
  })

  it('applies the current rate to the utterance', () => {
    setRateTTS(1.5)
    speakTTS('hello', 'en-US')
    expect(lastUtterance().rate).toBe(1.5)
  })

  it('replays the same text on end while loop is enabled', () => {
    setLoopTTS(true)
    speakTTS('loop me', 'en-US')
    expect(speakSpy).toHaveBeenCalledTimes(1)

    lastUtterance().onend?.()
    expect(speakSpy).toHaveBeenCalledTimes(2)
    expect(lastUtterance().text).toBe('loop me')
  })
})

describe('transport controls', () => {
  it('stop cancels speech and clears the speaking flag', () => {
    speakTTS('text', 'zh-CN')
    cancelSpy.mockClear()

    stopTTS()

    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(getTTSState().speaking).toBe(false)
    expect(getTTSState().progress).toBe(0)
  })

  it('pause/resume only act while speaking, and toggle the paused flag', () => {
    pauseTTS()
    expect(pauseSpy).not.toHaveBeenCalled()

    speakTTS('text', 'zh-CN')
    pauseTTS()
    expect(pauseSpy).toHaveBeenCalledTimes(1)
    expect(getTTSState().paused).toBe(true)

    // Pausing twice is a no-op.
    pauseTTS()
    expect(pauseSpy).toHaveBeenCalledTimes(1)

    resumeTTS()
    expect(resumeSpy).toHaveBeenCalledTimes(1)
    expect(getTTSState().paused).toBe(false)
  })

  it('clamps the speech rate into [0.5, 2]', () => {
    setRateTTS(0.1)
    expect(getTTSState().rate).toBe(0.5)
    setRateTTS(5)
    expect(getTTSState().rate).toBe(2)
    setRateTTS(1.25)
    expect(getTTSState().rate).toBe(1.25)
  })
})
