import { useState } from 'react'
import { THEMES } from '../types/models'

export function ThemeSwitcher(): React.ReactElement {
  const [current, setCurrent] = useState(() => localStorage.getItem('sophia-theme') || 'dark')

  const handleSelect = (themeId: string) => {
    if (themeId === 'dark') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', themeId)
    }
    localStorage.setItem('sophia-theme', themeId)
    setCurrent(themeId)
  }

  return (
    <div className="rounded-lg border border-surface-border bg-bg-surface p-6">
      <h3 className="mb-4 text-lg font-semibold text-text-primary">Theme</h3>
      <div className="grid grid-cols-4 gap-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => handleSelect(t.id)}
            className={`rounded-lg border-2 p-3 transition-all ${
              current === t.id
                ? 'border-accent-border shadow-lg'
                : 'border-surface-border hover:border-surface-border-strong'
            }`}
          >
            <div className="mb-2 flex gap-1">
              <div className="h-4 w-4 rounded-full" style={{ backgroundColor: t.preview.bg }} />
              <div className="h-4 w-4 rounded-full" style={{ backgroundColor: t.preview.surface }} />
              <div className="h-4 w-4 rounded-full" style={{ backgroundColor: t.preview.accent }} />
              <div className="h-4 w-4 rounded-full border border-surface-border-strong" style={{ backgroundColor: t.preview.text }} />
            </div>
            <p className={`text-xs font-medium ${current === t.id ? 'text-text-primary' : 'text-text-secondary'}`}>
              {t.name}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
