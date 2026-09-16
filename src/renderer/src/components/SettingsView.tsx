import { useState, useEffect, useCallback } from 'react'
import { ThemeSwitcher } from './ThemeSwitcher'
import { SettingsTextTemplatesSection } from './SettingsTextTemplatesSection'
import { SettingsBackupSection } from './SettingsBackupSection'
import { SettingsConfigSection } from './SettingsConfigSection'
import { SettingsVoiceTriggersSection } from './SettingsVoiceTriggersSection'
import { SettingsDictionarySection } from './SettingsDictionarySection'
import { SettingsArchiveSection } from './SettingsArchiveSection'
import { SettingsProvidersSection } from './SettingsProvidersSection'
import { WebDavSyncView } from './WebDavSyncView'
import {
  FONT_SCALE_OPTIONS,
  getFontScale,
  setFontScale,
  type FontScale
} from '../../../shared/font-scale'
import { loadThinkingMode, saveThinkingMode, type ThinkingMode } from '../../../shared/thinking'




export function SettingsView(): React.ReactElement {
  const [thinkingEnabled, setThinkingEnabled] = useState(
    () => loadThinkingMode()
  )
  const [hideNarration, setHideNarration] = useState(
    () => localStorage.getItem('sophia.hideNarration') === '1'
  )
  const [dailyGoal, setDailyGoal] = useState(
    () => localStorage.getItem('sophia.dailyGoal') ?? '0'
  )
  const [fontScale, setFontScaleState] = useState<FontScale>(() => getFontScale())
  const [lockEnabled, setLockEnabled] = useState(false)
  const [lockPin, setLockPin] = useState('')
  const [lockConfirmPin, setLockConfirmPin] = useState('')
  const [lockError, setLockError] = useState<string | null>(null)
  const [lockMsg, setLockMsg] = useState<string | null>(null)

  const loadLockStatus = useCallback(async () => {
    try {
      setLockEnabled(await window.sophia.data.lock.has())
    } catch {
      setLockEnabled(false)
    }
  }, [])

  useEffect(() => {
    void loadLockStatus()
  }, [loadLockStatus])

  const handleSetLock = async () => {
    setLockError(null)
    setLockMsg(null)
    if (lockPin.length < 4) {
      setLockError('密码至少 4 位')
      return
    }
    if (lockPin !== lockConfirmPin) {
      setLockError('两次输入的密码不一致')
      return
    }
    try {
      await window.sophia.data.lock.set(lockPin)
      setLockPin('')
      setLockConfirmPin('')
      setLockMsg('已启用档案锁，下次启动时需要解锁')
      await loadLockStatus()
    } catch (err) {
      setLockError(err instanceof Error ? err.message : '设置失败')
    }
  }

  const handleClearLock = async () => {
    setLockError(null)
    setLockMsg(null)
    await window.sophia.data.lock.clear()
    setLockMsg('已关闭档案锁')
    await loadLockStatus()
  }

  const handleRelock = () => {
    setLockMsg('已锁定')
    window.dispatchEvent(new Event('sophia:relock'))
  }


  const handleFontScale = (scale: FontScale) => {
    setFontScaleState(scale)
    setFontScale(scale)
  }


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
    <div className="mx-auto max-w-2xl p-8">
      <h2 className="mb-6 text-2xl font-bold">设置</h2>

      <ThemeSwitcher />

      <WebDavSyncView />

      <div className="mb-8" />

      <div className="mb-8">
        <h3 className="mb-3 text-lg font-semibold">界面字号</h3>
        <p className="mb-3 text-xs text-text-muted">调整整个界面的文字大小（课堂教材阅读器的字号不受影响）。</p>
        <div className="flex gap-2">
          {FONT_SCALE_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => handleFontScale(o.key)}
              className={`rounded px-4 py-2 text-sm transition-colors ${
                fontScale === o.key
                  ? 'bg-accent text-white'
                  : 'border border-surface-border-strong text-text-secondary hover:bg-bg-elevated'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      

      

      

      <SettingsBackupSection />

      

      <div className="mb-8">
        <h3 className="mb-3 text-lg font-semibold">档案锁</h3>
        <p className="mb-3 text-xs text-text-muted">
          给本地学习档案加一道密码，共用电脑时防止他人误入。密码使用系统加密保存。
        </p>
        {lockMsg && <p className="mb-2 text-xs text-green-400">{lockMsg}</p>}
        {lockError && <p className="mb-2 text-xs text-red-400">{lockError}</p>}
        {lockEnabled ? (
          <div className="rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
            <p className="text-sm text-text-secondary">
              档案锁已开启。
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleRelock}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                立即锁定
              </button>
              <button
                onClick={() => void handleClearLock()}
                className="rounded border border-surface-border-strong px-4 py-2 text-sm text-red-400 hover:bg-red-900/30"
              >
                关闭档案锁
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
            <div className="space-y-2">
              <input
                type="password"
                value={lockPin}
                onChange={(e) => setLockPin(e.target.value)}
                placeholder="设置解锁密码（至少 4 位）"
                className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
              />
              <input
                type="password"
                value={lockConfirmPin}
                onChange={(e) => setLockConfirmPin(e.target.value)}
                placeholder="再次输入确认"
                className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
              />
            </div>
            <button
              onClick={() => void handleSetLock()}
              disabled={!lockPin || !lockConfirmPin}
              className="mt-3 rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              启用档案锁
            </button>
          </div>
        )}
      </div>

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

      <SettingsConfigSection />

      <SettingsTextTemplatesSection />

      <SettingsVoiceTriggersSection />

      <SettingsDictionarySection />

      <SettingsArchiveSection />

      <SettingsProvidersSection />
    </div>
  )
}
