import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseAudioScript } from '../../../shared/lesson-media'

const RATES = [0.75, 1, 1.25, 1.5]

/**
 * 课后音频回顾播放器（里程碑 4）：双人回顾脚本 + Web Speech 合成。
 * 导师/学习者双声（pitch 区分），支持播放/暂停、倍速、上一段/下一段。
 */
export function AudioReviewPlayer({ content }: { content: string }): React.ReactElement {
  const lines = useMemo(() => parseAudioScript(content), [content])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [supported] = useState(() => typeof window !== 'undefined' && 'speechSynthesis' in window)
  const indexRef = useRef(0)
  const rateRef = useRef(1)

  indexRef.current = index
  rateRef.current = rate

  const speakLine = useCallback((i: number, onDone: () => void) => {
    if (!supported || i >= lines.length) return
    const u = new SpeechSynthesisUtterance(lines[i].text)
    u.lang = 'zh-CN'
    u.rate = rateRef.current
    u.pitch = lines[i].speaker === '导师' ? 0.85 : 1.2
    u.onend = onDone
    u.onerror = onDone
    window.speechSynthesis.speak(u)
  }, [supported, lines])

  const stopAll = useCallback(() => {
    window.speechSynthesis?.cancel()
  }, [])

  const startAt = useCallback((i: number) => {
    stopAll()
    setIndex(i)
    if (i >= lines.length) {
      setPlaying(false)
      return
    }
    setPlaying(true)
    speakLine(i, () => {
      if (indexRef.current === i) {
        startAt(i + 1)
      }
    })
  }, [stopAll, speakLine, lines.length])

  const toggle = useCallback(() => {
    if (!supported) return
    if (playing) {
      window.speechSynthesis.pause()
      setPlaying(false)
    } else if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume()
      setPlaying(true)
    } else {
      startAt(indexRef.current)
    }
  }, [playing, supported, startAt])

  const jump = useCallback((dir: 1 | -1) => {
    if (!supported) return
    const target = Math.max(0, Math.min(lines.length - 1, indexRef.current + dir))
    startAt(target)
  }, [supported, startAt, lines.length])

  useEffect(() => () => stopAll(), [stopAll])

  if (!supported) {
    return (
      <div className="max-w-3xl rounded-xl border border-surface-border bg-bg-surface p-4 text-sm text-text-muted">
        当前环境不支持语音合成，以下为回顾脚本原文。
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-surface-border bg-bg-surface p-3">
        <button
          onClick={toggle}
          disabled={lines.length === 0}
          className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {playing ? '⏸️ 暂停' : '▶️ 播放'}
        </button>
        <button
          onClick={() => jump(-1)}
          disabled={lines.length === 0}
          className="rounded border border-surface-border-strong px-3 py-1.5 text-sm text-text-muted hover:bg-bg-elevated disabled:opacity-50"
        >
          ⏮️ 上一段
        </button>
        <button
          onClick={() => jump(1)}
          disabled={lines.length === 0}
          className="rounded border border-surface-border-strong px-3 py-1.5 text-sm text-text-muted hover:bg-bg-elevated disabled:opacity-50"
        >
          下一段 ⏭️
        </button>
        <div className="flex items-center gap-1">
          {RATES.map((r) => (
            <button
              key={r}
              onClick={() => setRate(r)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                rate === r ? 'bg-accent text-white' : 'text-text-muted hover:bg-bg-elevated'
              }`}
            >
              {r}x
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-text-muted">
          {lines.length > 0 ? `第 ${index + 1}/${lines.length} 段` : '无脚本'}
        </span>
      </div>

      <div className="space-y-2">
        {lines.map((l, i) => (
          <div
            key={i}
            className={`rounded-xl border p-3 transition-colors ${
              i === index && playing
                ? 'border-accent bg-bg-surface'
                : 'border-surface-border bg-bg-elevated/50'
            }`}
          >
            <span
              className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                l.speaker === '导师' ? 'bg-accent/20 text-accent' : 'bg-green-900/30 text-green-400'
              }`}
            >
              {l.speaker}
            </span>
            <p className="text-sm leading-relaxed text-text-secondary">{l.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
