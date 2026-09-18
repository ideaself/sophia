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

  it('ignores boundary events without a numeric charIndex', () => {
    speakTTS('abcdef', 'zh-CN')
    const utter = lastUtterance()

    utter.onboundary?.({ charIndex: 2 })
    expect(getTTSState().progress).toBeCloseTo(1 / 3)

    utter.onboundary?.({} as { charIndex: number })
    expect(getTTSState().progress).toBeCloseTo(1 / 3)
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

describe('useTTS hook wrappers', () => {
  it('drives speech through the hook actions', async () => {
    const { renderHook, act } = await import('@testing-library/react')
    const { useTTS } = await import('../../../src/renderer/src/hooks/useTTS')

    const hook = renderHook(() => useTTS('zh-CN'))

    // speak → the utterance starts.
    act(() => hook.result.current.speak('你好世界'))
    const utterance = lastUtterance()
    act(() => utterance.onstart?.())
    expect(hook.result.current.speaking).toBe(true)

    // pause while speaking, then resume.
    act(() => hook.result.current.pause())
    expect(hook.result.current.paused).toBe(true)
    act(() => hook.result.current.resume())
    expect(hook.result.current.paused).toBe(false)

    // rate and loop setters.
    act(() => hook.result.current.setRate(1.5))
    expect(hook.result.current.rate).toBe(1.5)
    act(() => hook.result.current.setLoop(true))
    expect(hook.result.current.loop).toBe(true)

    // toggle() stops while speaking, then starts again.
    act(() => hook.result.current.toggle('再来一次'))
    expect(hook.result.current.speaking).toBe(false)
    act(() => hook.result.current.toggle('再来一次'))
    expect(speakSpy).toHaveBeenCalled()

    act(() => hook.result.current.stop())
    expect(hook.result.current.speaking).toBe(false)
  })

  it('treats an utterance error as speech end', async () => {
    const { renderHook, act } = await import('@testing-library/react')
    const { useTTS } = await import('../../../src/renderer/src/hooks/useTTS')

    const hook = renderHook(() => useTTS('zh-CN'))
    act(() => hook.result.current.speak('会出错的文本'))
    const utterance = lastUtterance()
    act(() => utterance.onstart?.())
    expect(hook.result.current.speaking).toBe(true)

    act(() => utterance.onerror?.())
    expect(hook.result.current.speaking).toBe(false)
  })

  it('pause/resume are no-ops when nothing is speaking', async () => {
    const { renderHook, act } = await import('@testing-library/react')
    const { useTTS } = await import('../../../src/renderer/src/hooks/useTTS')

    const hook = renderHook(() => useTTS('zh-CN'))
    act(() => hook.result.current.pause())
    act(() => hook.result.current.resume())

    expect(pauseSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
  })
})

describe('useTTS — unsupported platform', () => {
  it('no-ops every transport control when speechSynthesis is missing', async () => {
    const speechSynthesis = window.speechSynthesis
    delete (window as unknown as Record<string, unknown>).speechSynthesis
    try {
      vi.resetModules()
      const fresh = await import('../../../src/renderer/src/hooks/useTTS')

      expect(fresh.getTTSState().supported).toBe(false)
      fresh.speakTTS('文本', 'zh-CN')
      expect(speakSpy).not.toHaveBeenCalled()
      fresh.stopTTS()
      fresh.pauseTTS()
      fresh.resumeTTS()
      expect(cancelSpy).not.toHaveBeenCalled()
      expect(pauseSpy).not.toHaveBeenCalled()
      expect(resumeSpy).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: speechSynthesis
      })
    }
  })
})
