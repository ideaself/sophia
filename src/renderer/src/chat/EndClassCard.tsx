/**
 * End-of-class card shown in the message list (extracted from ClassroomView):
 * pending state, farewell, generated-artifact count, redo-missing and the
 * review/continue actions.
 */

import type { TabState } from './types'

export function EndClassCard({
  result,
  redoing,
  onReviewNewCards,
  onContinueLearning,
  onRedoArtifacts
}: {
  result: NonNullable<TabState['endResult']>
  redoing: boolean
  onReviewNewCards: () => void
  onContinueLearning: () => void
  onRedoArtifacts: () => void
}): React.ReactElement {
  return (
    <div className="rounded border border-surface-border bg-bg-elevated px-4 py-3 text-sm text-text-primary">
      <p className="font-medium">课程已结束</p>
      {result.pending && (
        <p className="mt-2 text-xs text-text-secondary animate-pulse">
          学习摘要后台生成中，完成后自动显示…
        </p>
      )}
      {result.generationError && (
        <p className="mt-2 text-xs text-red-500">
          后台生成失败：{result.generationError}
        </p>
      )}
      {result.farewell && (
        <p className="mt-2 text-sm text-text-secondary italic">{result.farewell}</p>
      )}
      {!result.pending && (
        <>
          <p className="mt-1 text-xs text-text-muted">
            已自动生成 {result.artifacts} 个学习摘要（课堂总结、记忆卡片、学习日记等）
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={onReviewNewCards}
              className="rounded bg-green-800 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
              title="复习本节课新生成的记忆卡片，不足时自动补充以前的到期卡片"
            >
              复习本节新卡
            </button>
            <button
              onClick={onContinueLearning}
              className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
              title="同一本教材、同一位伙伴开一节新课堂"
            >
              继续学习
            </button>
          </div>
        </>
      )}
      {result.failures && result.failures.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2">
          <p className="text-xs text-text-secondary">
            有 {result.failures.length} 项学习摘要生成失败（可能是网络中断），可只补齐缺失项。
          </p>
          <button
            onClick={onRedoArtifacts}
            disabled={redoing}
            className="flex-shrink-0 rounded bg-amber-700 px-3 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {redoing ? '补齐中...' : '补齐缺失产物'}
          </button>
        </div>
      )}
    </div>
  )
}
