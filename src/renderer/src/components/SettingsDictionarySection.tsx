import { useState } from 'react'
import { CollapsibleSection } from './CollapsibleSection'
import {
  DEFAULT_DICT_TEMPLATE,
  buildDictUrl,
  loadDictConfig,
  saveDictConfig
} from '../../../shared/dict'

/**
 * 在线词典设置（拆分自 SettingsView）：自动查词开关 + 网址模板 + 测试。
 */
export function SettingsDictionarySection(): React.ReactElement {
  const [dictConfig, setDictConfig] = useState(() => loadDictConfig())
  const [dictTestWord, setDictTestWord] = useState('hello')

  const handleDictChange = (patch: Partial<typeof dictConfig>) => {
    setDictConfig((prev) => {
      const next = { ...prev, ...patch }
      saveDictConfig(next)
      return next
    })
  }

  return (
    <>
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
    </>
  )
}
