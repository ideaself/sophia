// @vitest-environment jsdom
/**
 * ThemeSwitcher — theme picker: applies the theme, persists it and marks the
 * active option.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { ThemeSwitcher } from '../../../src/renderer/src/components/ThemeSwitcher'
import { THEMES } from '../../../src/renderer/src/types/models'

beforeEach(() => {
  localStorage.clear()
})

afterEach(cleanup)

describe('ThemeSwitcher', () => {
  it('renders every theme option with its preview swatches', () => {
    render(<ThemeSwitcher />)

    for (const theme of THEMES) {
      expect(screen.getByText(theme.name)).toBeTruthy()
    }
    expect(screen.getByText('Theme')).toBeTruthy()
  })

  it('applies, persists and highlights the selected theme', () => {
    const target = THEMES.find((t) => t.id !== 'auto')!
    render(<ThemeSwitcher />)

    fireEvent.click(screen.getByText(target.name))

    expect(localStorage.getItem('sophia-theme')).toBe(target.id)
    if (target.id === 'dark') {
      // The dark theme is the CSS default and removes the attribute.
      expect(document.documentElement.getAttribute('data-theme')).toBeNull()
    } else {
      expect(document.documentElement.getAttribute('data-theme')).toBe(target.id)
    }

    // The selected option is marked active.
    const selectedButton = screen.getByText(target.name).closest('button')!
    expect(selectedButton.className).toContain('border-accent-border')

    const other = THEMES.find((t) => t.id !== target.id)!
    const otherButton = screen.getByText(other.name).closest('button')!
    expect(otherButton.className).not.toContain('border-accent-border')
  })

  it('resolves the auto theme against the system preference', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })
    })

    render(<ThemeSwitcher />)
    fireEvent.click(screen.getByText(THEMES.find((t) => t.id === 'auto')!.name))

    expect(localStorage.getItem('sophia-theme')).toBe('auto')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
