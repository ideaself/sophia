interface FirstRunGuideProps {
  onFinish: () => void
}

/** 首次启动的三步引导（localStorage 标记后不再显示）。 */
export function FirstRunGuide({ onFinish }: FirstRunGuideProps): React.ReactElement {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-bg-deep">
      <div className="w-[480px] rounded-xl border border-surface-border bg-bg-surface p-8 shadow-2xl">
        <h2 className="text-xl font-bold text-text-primary">欢迎来到 Sophia</h2>
        <p className="mt-1.5 text-sm text-text-muted">你的苏格拉底式 AI 学习伙伴，三步开始</p>

        <div className="mt-6 space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-surface-border bg-bg-deep p-3.5">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm text-accent">1</span>
            <div>
              <p className="text-sm font-medium text-text-primary">选择学习伙伴</p>
              <p className="mt-0.5 text-xs text-text-muted">点击顶部「课堂 → 新建课堂」，挑选一位想一起学习的角色</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-surface-border bg-bg-deep p-3.5">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm text-accent">2</span>
            <div>
              <p className="text-sm font-medium text-text-primary">选择教材（可跳过）</p>
              <p className="mt-0.5 text-xs text-text-muted">先在「教材」页导入 PDF / EPUB / Markdown，课堂里可并排阅读并做批注</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-surface-border bg-bg-deep p-3.5">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm text-accent">3</span>
            <div>
              <p className="text-sm font-medium text-text-primary">开始课堂对话</p>
              <p className="mt-0.5 text-xs text-text-muted">向伙伴提问，下课后自动生成总结、记忆卡片和学习日记</p>
            </div>
          </div>
        </div>

        <button
          onClick={onFinish}
          className="mt-7 w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          开始学习 →
        </button>
      </div>
    </div>
  )
}
