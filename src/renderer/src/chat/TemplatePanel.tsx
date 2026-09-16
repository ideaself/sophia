/**
 * Saved-text template quick-insert panel (extracted from ClassroomView).
 *
 * Templates are read from localStorage once when the panel mounts (it is
 * mounted only while open) instead of on every classroom render.
 */

import { useState } from 'react'
import { loadTextTemplates, MAX_TEXT_TEMPLATES } from '../../../shared/text-templates'

export function TemplatePanel({
  onInsert,
  onClose
}: {
  onInsert: (template: string) => void
  onClose: () => void
}): React.ReactElement {
  const [templates] = useState<string[]>(() => loadTextTemplates())

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-80 rounded-lg border border-surface-border bg-bg-surface p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">常用文本模板（Alt+1..9 插入）</span>
        <button
          onClick={onClose}
          className="rounded p-1 text-xs text-text-muted hover:bg-bg-elevated"
          aria-label="关闭模板面板"
        >
          x
        </button>
      </div>
      {templates.length === 0 ? (
        <p className="text-xs text-text-muted">
          还没有模板。在「设置 → 常用文本模板」中添加，最多 {MAX_TEXT_TEMPLATES} 条。
        </p>
      ) : (
        <ul className="space-y-1">
          {templates.map((t, i) => (
            <li key={`${i}-${t}`}>
              <button
                onClick={() => onInsert(t)}
                className="w-full truncate rounded px-2 py-1 text-left text-xs text-text-secondary hover:bg-bg-elevated"
                title={t}
              >
                <kbd className="mr-1.5 rounded border border-surface-border-strong bg-bg-elevated px-1 py-0.5 font-mono text-[10px] text-text-muted">
                  Alt+{i + 1}
                </kbd>
                {t}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
