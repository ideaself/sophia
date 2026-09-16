import { useState } from 'react'
import { CollapsibleSection } from './CollapsibleSection'
import { loadTextTemplates, saveTextTemplates, MAX_TEXT_TEMPLATES, MAX_TEMPLATE_LENGTH } from '../../../shared/text-templates'

/**
 * 常用文本模板设置（拆分自 SettingsView）：Alt+1..9 快捷插入的片段管理。
 */
export function SettingsTextTemplatesSection(): React.ReactElement {
  const [templates, setTemplates] = useState<string[]>(() => loadTextTemplates())

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

  return (
    <>
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
    </>
  )
}
