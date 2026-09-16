import { useState, useEffect, useCallback } from 'react'
import { ThemeSwitcher } from './ThemeSwitcher'
import { CollapsibleSection } from './CollapsibleSection'
import { SettingsArchiveSection } from './SettingsArchiveSection'
import { SettingsProvidersSection } from './SettingsProvidersSection'
import { WebDavSyncView } from './WebDavSyncView'
import {
  FONT_SCALE_OPTIONS,
  getFontScale,
  setFontScale,
  type FontScale
} from '../../../shared/font-scale'
import {
  MAX_TEXT_TEMPLATES,
  MAX_TEMPLATE_LENGTH,
  loadTextTemplates,
  saveTextTemplates
} from '../../../shared/text-templates'
import {
  DEFAULT_VOICE_TRIGGERS,
  loadVoiceTriggers,
  saveVoiceTriggers
} from '../../../shared/voice-trigger'
import {
  DEFAULT_DICT_TEMPLATE,
  loadDictConfig,
  saveDictConfig,
  buildDictUrl
} from '../../../shared/dict'
import { loadThinkingMode, saveThinkingMode, type ThinkingMode } from '../../../shared/thinking'

/** 可导出/导入的界面设置（localStorage key 白名单，不含密钥等敏感数据）。 */
const UI_SETTINGS_KEYS = [
  'sophia-theme',
  'sophia.fontScale',
  'sophia.textTemplates',
  'sophia.voiceTriggers',
  'sophia.dictEnabled',
  'sophia.dictTemplate',
  'sophia.dictPopupPrefs',
  'sophia.thinkingEnabled',
  'sophia.hideNarration',
  'sophia.dailyGoal'
] as const



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
  const [backingUp, setBackingUp] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null)
  const [fontScale, setFontScaleState] = useState<FontScale>(() => getFontScale())
  const [templates, setTemplates] = useState<string[]>(() => loadTextTemplates())
  const [voiceTriggers, setVoiceTriggers] = useState(() => loadVoiceTriggers())
  const [dictConfig, setDictConfig] = useState(() => loadDictConfig())
  const [dictTestWord, setDictTestWord] = useState('hello')

  const handleDictChange = (patch: Partial<typeof dictConfig>) => {
    setDictConfig((prev) => {
      const next = { ...prev, ...patch }
      saveDictConfig(next)
      return next
    })
  }

  const handleVoiceTriggerChange = (field: 'send' | 'clear', value: string) => {
    setVoiceTriggers((prev) => {
      const next = { ...prev, [field]: value }
      saveVoiceTriggers(next)
      return next
    })
  }
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

  const updateTemplate = (index: number, value: string) => {
    setTemplates((prev) => {
      const next = [...prev]
      next[index] = value
      saveTextTemplates(next)
      return next
    })
  }

  const addTemplate = () => {
    setTemplates((prev) => {
      if (prev.length >= MAX_TEXT_TEMPLATES) return prev
      const next = [...prev, '']
      saveTextTemplates(next)
      return next
    })
  }

  const removeTemplate = (index: number) => {
    setTemplates((prev) => {
      const next = prev.filter((_, i) => i !== index)
      saveTextTemplates(next)
      return next
    })
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

  const [configMsg, setConfigMsg] = useState<string | null>(null)

  const handleExportSettings = async () => {
    setConfigMsg(null)
    const data: Record<string, string> = {}
    for (const key of UI_SETTINGS_KEYS) {
      const v = localStorage.getItem(key)
      if (v !== null) data[key] = v
    }
    const result = await window.sophia.dialog.saveFile({
      defaultPath: `sophia-设置-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON 配置', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return
    const payload = JSON.stringify({ app: 'sophia', version: 1, settings: data }, null, 2)
    const written = await window.sophia.data.writeTextFile(result.filePath, payload)
    setConfigMsg(written.success ? `已导出 ${Object.keys(data).length} 项设置` : '导出失败')
  }

  const handleImportSettings = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setConfigMsg(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as { settings?: unknown } | Record<string, unknown>
        const data = parsed && typeof parsed === 'object' && 'settings' in parsed && parsed.settings
          ? (parsed.settings as Record<string, unknown>)
          : parsed
        if (!data || typeof data !== 'object') throw new Error('bad format')
        let count = 0
        for (const [key, value] of Object.entries(data)) {
          if (UI_SETTINGS_KEYS.includes(key as (typeof UI_SETTINGS_KEYS)[number]) && typeof value === 'string') {
            localStorage.setItem(key, value)
            count++
          }
        }
        if (count === 0) throw new Error('no settings')
        window.location.reload()
      } catch {
        setConfigMsg('导入失败：文件格式不正确')
      }
    }
    reader.onerror = () => setConfigMsg('读取文件失败')
    reader.readAsText(file)
  }

  const handleExportBackup = async () => {
    setBackingUp(true)
    setBackupMsg(null)
    try {
      const result = await window.sophia.dialog.saveFile({
        defaultPath: `sophia-backup-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: 'ZIP 备份', extensions: ['zip'] }]
      })
      if (result.canceled || !result.filePath) return
      const backup = await window.sophia.data.exportBackup(result.filePath)
      setBackupMsg(`备份完成，共 ${backup.fileCount} 个文件`)
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : '备份失败')
    } finally {
      setBackingUp(false)
    }
  }

  const handleRestoreBackup = async () => {
    setRestoreMsg(null)
    const ok = await window.sophia.dialog.confirm({
      message: '从备份恢复会用备份数据替换当前全部学习数据。恢复前会自动先为当前数据做一份保险备份。确定继续吗？',
      confirmLabel: '恢复',
      cancelLabel: '取消'
    })
    if (!ok) return
    const result = await window.sophia.dialog.openFile({
      filters: [{ name: 'ZIP 备份', extensions: ['zip'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return
    setRestoring(true)
    try {
      const res = await window.sophia.data.restoreBackup(result.filePaths[0])
      if (res.success) {
        setRestoreMsg('恢复成功。界面将刷新以加载恢复后的数据…')
        setTimeout(() => window.location.reload(), 1500)
      } else {
        setRestoreMsg(`恢复失败：${res.error ?? '未知错误'}`)
      }
    } catch (err) {
      setRestoreMsg(`恢复失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setRestoring(false)
    }
  }

  const handleOpenDataDir = async () => {
    const res = await window.sophia.app.openDataDir()
    if (!res.success) setRestoreMsg(`无法打开数据目录：${res.error ?? '未知错误'}`)
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

      

      

      

      <div className="mb-8">
        <h3 className="mb-3 text-lg font-semibold">数据备份</h3>
        <div className="rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
          <p className="text-sm text-text-secondary">
            将全部学习数据（对话、产物、教材、闪卡复习状态等）打包为一个 zip 文件，用于本地备份。
          </p>
          <p className="mt-2 text-xs text-text-muted">
            应用每次启动时会自动检查备份：每 7 天自动备份一次，保留最近 5 份（位于用户数据目录的 Sophia-backups 文件夹）。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void handleExportBackup()}
              disabled={backingUp}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {backingUp ? '备份中...' : '导出全部数据备份'}
            </button>
            <button
              onClick={() => void handleRestoreBackup()}
              disabled={restoring}
              className="rounded border border-red-800 px-4 py-2 text-sm text-red-400 hover:bg-red-900/30 disabled:opacity-50"
            >
              {restoring ? '恢复中...' : '从备份恢复'}
            </button>
            <button
              onClick={() => void handleOpenDataDir()}
              className="rounded border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated"
            >
              打开数据目录
            </button>
            {backupMsg && <span className="text-xs text-text-muted">{backupMsg}</span>}
            {restoreMsg && <span className="text-xs text-text-muted">{restoreMsg}</span>}
          </div>
        </div>
      </div>

      

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

      <div className="mb-8">
        <h3 className="mb-3 text-lg font-semibold">配置导出 / 导入</h3>
        <div className="rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
          <p className="text-sm text-text-secondary">
            导出或恢复界面设置（主题、字号、文本模板、语音触发、词典、课堂行为、每日目标）。不含账号密钥等敏感信息。
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => void handleExportSettings()}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              导出配置
            </button>
            <label className="cursor-pointer rounded border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated">
              导入配置
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportSettings}
              />
            </label>
            {configMsg && <span className="text-xs text-text-muted">{configMsg}</span>}
          </div>
        </div>
      </div>

      <CollapsibleSection title="常用文本模板" badge={`${templates.length}/${MAX_TEXT_TEMPLATES}`}>
        <p className="mb-3 text-xs text-text-muted">
          设置常用文字片段（最多 {MAX_TEXT_TEMPLATES} 条，每条 ≤ {MAX_TEMPLATE_LENGTH} 字）。
          在课堂输入框点「☰」按钮或按 Alt+1..9 插入。
        </p>
        <div className="space-y-2">
          {templates.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <kbd className="flex-shrink-0 rounded border border-surface-border-strong bg-bg-elevated px-2 py-1.5 font-mono text-xs text-text-muted">
                Alt+{i + 1}
              </kbd>
              <input
                type="text"
                value={t}
                maxLength={MAX_TEMPLATE_LENGTH}
                onChange={(e) => updateTemplate(i, e.target.value)}
                placeholder={`第 ${i + 1} 条模板（点击后可在输入框插入）`}
                aria-label={`第 ${i + 1} 条快捷模板`}
                className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
              />
              <button
                onClick={() => removeTemplate(i)}
                className="flex-shrink-0 rounded border border-surface-border-strong px-3 py-2 text-sm text-red-400 hover:bg-red-900/30"
                title="删除此模板"
                aria-label={`删除第 ${i + 1} 条模板`}
              >
                ✕
              </button>
            </div>
          ))}
          {templates.length < MAX_TEXT_TEMPLATES && (
            <button
              onClick={addTemplate}
              className="w-full rounded-lg border border-dashed border-surface-border-strong px-4 py-2.5 text-sm text-text-muted hover:border-accent-border hover:text-accent-hover transition-colors"
            >
              + 添加模板
            </button>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="语音输入触发词">
        <p className="mb-3 text-xs text-text-muted">
          用系统或第三方语音输入（macOS 听写、Windows 系统语音、讯飞输入法等）说话时，
          说完设定好的触发短语即可免手发送或清空消息。
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="w-16 flex-shrink-0 text-xs text-text-muted">发送</label>
            <input
              type="text"
              value={voiceTriggers.send}
              maxLength={20}
              onChange={(e) => handleVoiceTriggerChange('send', e.target.value)}
              placeholder={`默认：${DEFAULT_VOICE_TRIGGERS.send}`}
              className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
            />
            <span className="flex-shrink-0 text-xs text-text-muted">在输入末尾说出即自动发送</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-16 flex-shrink-0 text-xs text-text-muted">清空</label>
            <input
              type="text"
              value={voiceTriggers.clear}
              maxLength={20}
              onChange={(e) => handleVoiceTriggerChange('clear', e.target.value)}
              placeholder={`默认：${DEFAULT_VOICE_TRIGGERS.clear}`}
              className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
            />
            <span className="flex-shrink-0 text-xs text-text-muted">在输入末尾说出即清空输入</span>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="在线词典" defaultOpen>
        <p className="mb-3 text-xs text-text-muted">
          在教材阅读器（EPUB）中选中英文单词时，自动弹出词典查询。可自定义词典网址模板。
        </p>
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
          <div className="pr-4">
            <p className="text-sm font-medium">选中英文单词自动查词</p>
            <p className="mt-0.5 text-xs text-text-muted">关闭后仍可在选区菜单中手动点「查词」</p>
          </div>
          <input
            type="checkbox"
            checked={dictConfig.enabled}
            onChange={(e) => handleDictChange({ enabled: e.target.checked })}
            className="h-4 w-4 flex-shrink-0"
          />
        </label>
        <div className="mt-2 rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
          <label className="mb-1 block text-xs font-medium text-text-muted">
            词典网址模板（用 <code className="rounded bg-bg-elevated px-1">{"{word}"}</code> 表示单词位置）
          </label>
          <input
            type="text"
            value={dictConfig.template}
            onChange={(e) => handleDictChange({ template: e.target.value })}
            placeholder={DEFAULT_DICT_TEMPLATE}
            className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-text-muted">测试单词</span>
            <input
              type="text"
              value={dictTestWord}
              onChange={(e) => setDictTestWord(e.target.value)}
              className="w-32 rounded border border-surface-border-strong bg-bg-deep px-2 py-1 text-sm text-text-primary focus:border-accent-border focus:outline-none"
            />
            <button
              onClick={() => window.open(buildDictUrl(dictConfig.template, dictTestWord), '_blank')}
              disabled={!dictTestWord.trim()}
              className="rounded border border-accent px-3 py-1 text-xs text-accent-hover hover:bg-accent-subtle disabled:opacity-50"
            >
              在新窗口测试
            </button>
            <span className="text-xs text-text-muted">示例：{buildDictUrl(dictConfig.template, 'hello')}</span>
          </div>
        </div>
      </CollapsibleSection>

      <SettingsArchiveSection />

      <SettingsProvidersSection />
    </div>
  )
}
