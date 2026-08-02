import { useCallback, useSyncExternalStore } from 'react'
import { stripMarkdown } from '../../../shared/tts-utils'

export { stripMarkdown }

export interface UseTTSResult {
  /** Whether the platform exposes the Web Speech API. */
  supported: boolean
  speaking: boolean
  paused: boolean
  /** 0..1 — progress of the current utterance (based on onboundary events). */
  progress: number
  /** Speech rate, clamped to [0.5, 2]. */
  rate: number
  setRate: (rate: number) => void
  /** Loop the current utterance until stopped (3.2.0). */
  loop: boolean
  setLoop: (loop: boolean) => void
  speak: (text: string) => void
  stop: () => void
  /** Speak if idle, stop if speaking. */
  toggle: (text: string) => void
  pause: () => void
  resume: () => void
}

interface TTSState {
  supported: boolean
  speaking: boolean
  paused: boolean
  progress: number
  rate: number
  loop: boolean
}

const MIN_RATE = 0.5
const MAX_RATE = 2
const DEFAULT_RATE = 1

function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined' &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

/**
 * Module-level TTS store.
 *
 * `speechSynthesis` is a process-wide singleton, so playback state must be
 * shared too. Individual buttons only subscribe to this store — they must NOT
 * cancel speech when unmounting, otherwise virtualized message lists would
 * kill an ongoing reading as rows scroll out of view. Cancellation is owned
 * by container components (ClassroomView / EpubReaderView) on unmount.
 */
let state: TTSState = {
  supported: isSupported(),
  speaking: false,
  paused: false,
  progress: 0,
  rate: DEFAULT_RATE,
  loop: false
}

const listeners = new Set<() => void>()

function setState(patch: Partial<TTSState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function subscribeTTS(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getTTSState(): TTSState {
  return state
}

export function speakTTS(rawText: string, lang: string): void {
  if (!isSupported()) return
  const text = rawText.trim()
  if (!text) return

  window.speechSynthesis.cancel()

  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = lang
  utter.rate = state.rate
  utter.onstart = () => setState({ speaking: true, paused: false, progress: 0 })
  utter.onboundary = (e) => {
    if (typeof e.charIndex === 'number' && text.length > 0) {
      setState({ progress: Math.min(1, Math.max(0, e.charIndex / text.length)) })
    }
  }
  utter.onend = () => {
    // Loop (3.2.0): replay the utterance unless the user stopped it.
    if (state.loop) {
      speakTTS(text, lang)
    } else {
      setState({ speaking: false, paused: false, progress: 1 })
    }
  }
  utter.onerror = () => setState({ speaking: false, paused: false, progress: 0 })

  window.speechSynthesis.speak(utter)
  setState({ speaking: true, paused: false, progress: 0 })
}

export function stopTTS(): void {
  if (!isSupported()) return
  window.speechSynthesis.cancel()
  setState({ speaking: false, paused: false, progress: 0 })
}

export function pauseTTS(): void {
  if (!isSupported() || !state.speaking || state.paused) return
  window.speechSynthesis.pause()
  setState({ paused: true })
}

export function resumeTTS(): void {
  if (!isSupported() || !state.speaking || !state.paused) return
  window.speechSynthesis.resume()
  setState({ paused: false })
}

export function setRateTTS(rate: number): void {
  setState({ rate: Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) })
}

export function setLoopTTS(loop: boolean): void {
  setState({ loop })
}

/**
 * React binding over the shared TTS store.
 *
 * The returned controls operate on the global speechSynthesis singleton, so
 * multiple callers stay in sync with the same speaking/paused/progress state.
 */
export function useTTS(lang = 'zh-CN'): UseTTSResult {
  const { supported, speaking, paused, progress, rate, loop } = useSyncExternalStore(
    subscribeTTS,
    getTTSState,
    getTTSState
  )

  const speak = useCallback((text: string) => speakTTS(text, lang), [lang])
  const stop = useCallback(() => stopTTS(), [])
  const pause = useCallback(() => pauseTTS(), [])
  const resume = useCallback(() => resumeTTS(), [])
  const setRate = useCallback((value: number) => setRateTTS(value), [])
  const setLoop = useCallback((value: boolean) => setLoopTTS(value), [])
  const toggle = useCallback(
    (text: string) => {
      if (speaking) {
        stopTTS()
      } else {
        speakTTS(text, lang)
      }
    },
    [speaking, lang]
  )

  return {
    supported,
    speaking,
    paused,
    progress,
    rate,
    setRate,
    loop,
    setLoop,
    speak,
    stop,
    toggle,
    pause,
    resume
  }
}
