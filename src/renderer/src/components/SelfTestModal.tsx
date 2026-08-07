import { useState } from 'react'
import type { SelfTestQuestion } from '../../../shared/self-test-utils'

interface SelfTestModalProps {
  questions: SelfTestQuestion[]
  onClose: () => void
}

/**
 * Interactive post-class self-test: question first, then hints are revealed
 * one by one, then the answer — mirrors the original's staged reveal.
 */
export function SelfTestModal({ questions, onClose }: SelfTestModalProps): React.ReactElement {
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(0)

  const q = questions[index]
  const maxReveal = q.hints.length + 1 // hints + answer
  const answerShown = revealed > q.hints.length

  const nextRevealLabel =
    revealed === 0
      ? '显示提示 1'
      : revealed < q.hints.length
        ? `显示提示 ${revealed + 1}`
        : answerShown
          ? '下一题'
          : '显示答案'

  const goTo = (i: number) => {
    setIndex(i)
    setRevealed(0)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-2xl border border-surface-border bg-bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-surface-border px-5 py-3">
          <h3 className="text-sm font-semibold">课后自测</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-muted">
              第 {index + 1}/{questions.length} 题
            </span>
            <button
              onClick={onClose}
              className="rounded px-2 py-1 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
              title="关闭 (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <p className="mb-4 text-sm font-medium leading-relaxed text-text-primary">
            {q.question}
          </p>
          <div className="space-y-3">
            {q.hints.slice(0, revealed).map((hint, i) => (
              <div key={i} className="rounded-lg border border-amber-700/40 bg-amber-900/15 px-3 py-2">
                <p className="mb-1 text-[10px] font-medium uppercase text-amber-700">
                  提示 {i + 1}
                </p>
                <p className="text-sm leading-relaxed text-text-secondary">{hint}</p>
              </div>
            ))}
            {answerShown && (
              <div className="rounded-lg border border-green-800/40 bg-green-900/15 px-3 py-2">
                <p className="mb-1 text-[10px] font-medium uppercase text-green-400">答案</p>
                <p className="text-sm leading-relaxed text-text-secondary">{q.answer}</p>
              </div>
            )}
            {revealed === 0 && (
              <p className="text-xs text-text-muted">
                先自己作答，再逐步显示提示和答案。
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-surface-border px-5 py-3">
          <button
            onClick={() => goTo(Math.max(0, index - 1))}
            disabled={index === 0}
            className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated disabled:opacity-30"
          >
            上一题
          </button>
          <button
            onClick={() => {
              if (answerShown) {
                if (index < questions.length - 1) goTo(index + 1)
                else onClose()
              } else {
                setRevealed((r) => Math.min(maxReveal, r + 1))
              }
            }}
            className="rounded bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
          >
            {answerShown && index === questions.length - 1 ? '完成' : nextRevealLabel}
          </button>
          <button
            onClick={() => goTo(Math.min(questions.length - 1, index + 1))}
            disabled={index === questions.length - 1}
            className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated disabled:opacity-30"
          >
            下一题
          </button>
        </div>
      </div>
    </div>
  )
}
