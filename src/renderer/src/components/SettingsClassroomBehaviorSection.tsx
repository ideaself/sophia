import { useState } from 'react'
import { loadThinkingMode, saveThinkingMode, type ThinkingMode } from '../../../shared/thinking'

/**
 * 课堂行为设置（拆分自 SettingsView）：思考深度 / 每日目标 / 纯净对话。
 */
export function SettingsClassroomBehaviorSection(): React.ReactElement {
  const [thinkingEnabled, setThinkingEnabled] = useState(
    () => loadThinkingMode()
  )
  const [hideNarration, setHideNarration] = useState(
    () => localStorage.getItem('sophia.hideNarration') === '1'
  )
  const [dailyGoal, setDailyGoal] = useState(
    () => localStorage.getItem('sophia.dailyGoal') ?? '0'
  )

  const handleToggleThinking = (mode: ThinkingMode) => {
    setThinkingEnabled(mode)
    saveThinkingMode(mode)
  }

  const handleToggleHideNarration = (enabled: boolean) => {
    setHideNarration(enabled)
    localStorage.setItem('sophia.hideNarration', enabled ? '1' : '0')
  }

  const handleDailyGoalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setDailyGoal(v)
    localStorage.setItem('sophia.dailyGoal', v)
    window.dispatchEvent(new Event('sophia:goal-changed'))
  }

  return (
    <>
      <div className="mb-8">
        <h3 className="mb-3 text-lg font-semibold">课堂行为</h3>
        <div className="flex cursor-pointer items-center justify-between rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
          <div className="pr-4">
            <p className="text-sm font-medium">思考深度（Thinking）</p>
            <p className="mt-0.5 text-xs text-text-muted">自动：简单问题快速开口，需要多步分析时再深入思考；课后摘要、闪卡等生成不受影响</p>
          </div>
          <div className="flex flex-shrink-0 overflow-hidden rounded-full border border-surface-border-strong text-xs">
            {([
              ['auto', '自动'],
              ['on', '开启'],
              ['off', '关闭']
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => handleToggleThinking(mode)}
                className={`px-3 py-1.5 transition-colors ${
                  thinkingEnabled === mode
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="mt-2 flex cursor-pointer items-center justify-between rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
          <div className="pr-4">
            <p className="text-sm font-medium">每日学习目标</p>
            <p className="mt-0.5 text-xs text-text-muted">课堂顶栏显示当日学习进度环（0 = 关闭）</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={600}
              value={dailyGoal}
              onChange={handleDailyGoalChange}
              className="w-20 rounded border border-surface-border-strong bg-bg-deep px-2 py-1 text-right text-sm text-text-primary focus:border-accent-border focus:outline-none"
            />
            <span className="text-xs text-text-muted">分钟</span>
          </div>
        </label>
        <label className="mt-2 flex cursor-pointer items-center justify-between rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
          <div className="pr-4">
            <p className="text-sm font-medium">纯净对话（隐藏动作/表情旁白）</p>
            <p className="mt-0.5 text-xs text-text-muted">只显示对话正文与提问，伙伴不再输出 `*动作/表情*` 舞台说明</p>
          </div>
          <input
            type="checkbox"
            checked={hideNarration}
            onChange={(e) => handleToggleHideNarration(e.target.checked)}
            className="h-4 w-4 flex-shrink-0"
          />
        </label>
      </div>
    </>
  )
}
