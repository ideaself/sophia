import { useState } from 'react'

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

/**
 * 配置导出 / 导入设置（拆分自 SettingsView）：只包含本地界面设置白名单。
 */
export function SettingsConfigSection(): React.ReactElement {
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
    /* v8 ignore next -- @preserve */
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

  return (
    <>
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
    </>
  )
}
