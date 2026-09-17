// @vitest-environment jsdom
/**
 * theme — stored-theme lookup, <html data-theme> application and the
 * transient transition attribute.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { getStoredTheme, applyTheme, withThemeTransition } from '../../../src/renderer/src/lib/theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-transition')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getStoredTheme', () => {
  it('returns known themes and falls back to auto', () => {
    expect(getStoredTheme()).toBe('auto')

    localStorage.setItem('sophia-theme', 'light')
    expect(getStoredTheme()).toBe('light')

    localStorage.setItem('sophia-theme', 'not-a-theme')
    expect(getStoredTheme()).toBe('auto')
  })
})

describe('applyTheme', () => {
  it('sets the attribute for explicit themes and clears it for dark', () => {
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })

  it('resolves auto from the system preference', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: false, media: query })
    })
    applyTheme('auto')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: true, media: query })
    })
    applyTheme('auto')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('withThemeTransition', () => {
  it('marks the transition, runs the callback and cleans up after 250ms', () => {
    vi.useFakeTimers()
    const fn = vi.fn()

    withThemeTransition(fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(document.documentElement.getAttribute('data-theme-transition')).toBe('')

    vi.advanceTimersByTime(250)
    expect(document.documentElement.getAttribute('data-theme-transition')).toBeNull()
  })
})
