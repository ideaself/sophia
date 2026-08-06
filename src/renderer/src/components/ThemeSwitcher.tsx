import { useState } from 'react'
import { THEMES } from '../types/models'
import { applyTheme, getStoredTheme, withThemeTransition } from '../lib/theme'

export function ThemeSwitcher(): React.ReactElement {
  const [current, setCurrent] = useState(() => getStoredTheme())

  const handleSelect = (themeId: string) => {
    withThemeTransition(() => applyTheme(themeId))
    localStorage.setItem('sophia-theme', themeId)
    setCurrent(themeId)
  }

  return (
    <div className="rounded-lg border border-surface-border bg-bg-surface p-6">
      <h3 className="mb-4 text-lg font-semibold text-text-primary">Theme</h3>
      <div className="grid grid-cols-4 gap-2">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => handleSelect(t.id)}
            className={`rounded-lg border-2 px-2 py-2.5 transition-all ${
              current === t.id
                ? 'border-accent-border shadow-lg'
                : 'border-surface-border hover:border-surface-border-strong'
            }`}
          >
            <div className="mb-1.5 flex justify-center gap-1">
              <div className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: t.preview.bg }} />
              <div className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: t.preview.surface }} />
              <div className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: t.preview.accent }} />
              <div className="h-3.5 w-3.5 rounded-full border border-surface-border-strong" style={{ backgroundColor: t.preview.text }} />
            </div>
            <p className={`text-center text-xs font-medium ${current === t.id ? 'text-text-primary' : 'text-text-secondary'}`}>
              {t.name}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
