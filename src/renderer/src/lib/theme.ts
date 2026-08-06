import { THEMES } from '../types/models'

export function getStoredTheme(): string {
  const saved = localStorage.getItem('sophia-theme')
  return saved && THEMES.some((t) => t.id === saved) ? saved : 'dark'
}

/**
 * Apply a theme id to <html data-theme="...">. 'dark' is the CSS default
 * (kept without an attribute so `:root` rules win); 'auto' resolves the
 * system light/dark preference at call time.
 */
export function applyTheme(themeId: string): void {
  if (themeId === 'auto') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  } else if (themeId === 'dark') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', themeId)
  }
}

/**
 * Run fn with a transient attribute that enables the theme-switch color
 * transition (see [data-theme-transition] in main.css). Removed shortly
 * after so the animation never interferes with normal interactions.
 */
export function withThemeTransition(fn: () => void): void {
  const root = document.documentElement
  root.setAttribute('data-theme-transition', '')
  fn()
  window.setTimeout(() => root.removeAttribute('data-theme-transition'), 250)
}
