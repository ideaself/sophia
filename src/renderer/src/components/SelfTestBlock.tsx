import { useState } from 'react'
import type { SelfTestQuestion } from '../../../shared/self-test-utils'

/** 逐级揭晓自测题（提示1 → 提示2 → 答案）。复盘页与课堂测验卡共用。 */
export function SelfTestBlock({ questions }: { questions: SelfTestQuestion[] }): React.ReactElement {
  const [revealed, setRevealed] = useState<Record<number, number>>({})

  const nextLabel = (i: number) => {
    const r = revealed[i] ?? 0
    const q = questions[i]
    if (r === 0) return q.hints.length > 0 ? '显示提示 1' : '显示答案'
    if (r < q.hints.length) return `显示提示 ${r + 1}`
    return '显示答案'
  }

  return (
    <div className="space-y-4">
      {questions.map((q, i) => {
        const r = revealed[i] ?? 0
        const answerShown = r > q.hints.length
        return (
          <div key={i} className="rounded-xl border border-surface-border bg-bg-surface p-4">
            <p className="mb-3 text-sm font-medium leading-relaxed text-text-primary">
              {i + 1}. {q.question}
            </p>
            <div className="space-y-2">
              {q.hints.slice(0, Math.min(r, q.hints.length)).map((hint, hi) => (
                <div key={hi} className="rounded-lg border border-amber-700/40 bg-amber-900/15 px-3 py-2">
                  <p className="mb-1 text-[10px] font-medium uppercase text-amber-700">提示 {hi + 1}</p>
                  <p className="text-sm leading-relaxed text-text-secondary">{hint}</p>
                </div>
              ))}
              {answerShown && (
                <div className="rounded-lg border border-green-800/40 bg-green-900/15 px-3 py-2">
                  <p className="mb-1 text-[10px] font-medium uppercase text-green-400">答案</p>
                  <p className="text-sm leading-relaxed text-text-secondary">{q.answer}</p>
                </div>
              )}
              {r === 0 && <p className="text-xs text-text-muted">先自己作答，再逐步显示提示和答案。</p>}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setRevealed((prev) => ({ ...prev, [i]: Math.min(q.hints.length + 1, (prev[i] ?? 0) + 1) }))}
                className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
              >
                {answerShown ? '已显示答案 ✓' : nextLabel(i)}
              </button>
              {r > 0 && (
                <button
                  onClick={() => setRevealed((prev) => ({ ...prev, [i]: 0 }))}
                  className="rounded border border-surface-border-strong px-3 py-1 text-xs text-text-muted hover:bg-bg-elevated"
                >
                  收起
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
