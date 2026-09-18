import { useEffect, useState } from 'react'
import { useCompanionStore } from '../stores/useCompanionStore'
import { useTextbookStore } from '../stores/useTextbookStore'
import type { Companion, Textbook } from '../types/models'

interface NewClassroomModalProps {
  /** 从「角色」页「开始对话」进入时预选的角色（跳过选角色步骤）。 */
  initialCompanion: Companion | null
  onConfirm: (comp: Companion, textbook: Textbook | null) => void
  onCancel: () => void
}

/**
 * 新建课堂弹窗：先选学习伙伴，再选教材（可不用教材），确认后打开一个
 * 全新的空白课堂。新会话在历史中按所选教材自动归组。
 */
export function NewClassroomModal({ initialCompanion, onConfirm, onCancel }: NewClassroomModalProps): React.ReactElement {
  const companions = useCompanionStore((s) => s.companions)
  const textbooks = useTextbookStore((s) => s.textbooks)
  const [step, setStep] = useState<'companion' | 'textbook'>(initialCompanion ? 'textbook' : 'companion')
  const [picked, setPicked] = useState<Companion | null>(initialCompanion)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-classroom-title"
        className="flex h-[72vh] w-[560px] flex-col rounded-lg border border-surface-border-strong bg-bg-deep shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <h3 id="new-classroom-title" className="text-sm font-semibold text-text-primary">
            {step === 'companion'
              ? '新建课堂 · 选择学习伙伴'
              : `新建课堂 · 选择教材（${picked!.name}）`}
          </h3>
          <button
            onClick={onCancel}
            className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
            title="取消 (Esc)"
            aria-label="取消"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {step === 'companion' ? (
            companions.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-text-muted">
                还没有角色，请先到「角色」页创建一位学习伙伴
              </p>
            ) : (
              <div className="space-y-2">
                {companions.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setPicked(c); setStep('textbook') }}
                    className="w-full rounded-lg border border-surface-border bg-bg-surface p-3 text-left transition-colors hover:border-accent-border hover:bg-bg-elevated"
                  >
                    <span className="font-medium text-text-primary">{c.name}</span>
                    <p className="mt-1 text-xs text-text-muted">{c.identity}</p>
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-2">
              <button
                onClick={() => picked && onConfirm(picked, null)}
                className="w-full rounded-lg border border-dashed border-surface-border-strong p-3 text-left text-sm text-text-muted transition-colors hover:border-accent-border hover:text-accent-hover"
              >
                不使用教材（自由对话）
              </button>
              {textbooks.map((tb) => (
                <button
                  key={tb.id}
                  onClick={() => picked && onConfirm(picked, tb)}
                  className="w-full rounded-lg border border-surface-border bg-bg-surface p-3 text-left transition-colors hover:border-accent-border hover:bg-bg-elevated"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-text-primary truncate">{tb.title}</span>
                    <span className="flex-shrink-0 text-[10px] text-text-muted">{tb.format}</span>
                  </div>
                </button>
              ))}
              {textbooks.length === 0 && (
                <p className="px-2 py-2 text-xs text-text-muted">暂无教材，可先不使用教材开始对话</p>
              )}
            </div>
          )}
        </div>

        {step === 'textbook' && (
          <div className="border-t border-surface-border p-2">
            <button
              onClick={() => setStep('companion')}
              className="rounded px-3 py-1.5 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
            >
              ← 重新选择角色
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
