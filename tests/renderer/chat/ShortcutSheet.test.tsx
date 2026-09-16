// @vitest-environment jsdom
/**
 * ShortcutSheet — keyboard cheat sheet dialog.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { ShortcutSheet } from '../../../src/renderer/src/chat/ShortcutSheet'

afterEach(() => {
  cleanup()
})

describe('ShortcutSheet', () => {
  it('lists the classroom shortcuts with dialog semantics', () => {
    render(<ShortcutSheet onClose={() => {}} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText('键盘快捷键')).toBeTruthy()

    expect(screen.getByText('Ctrl + T')).toBeTruthy()
    expect(screen.getByText('Ctrl + F')).toBeTruthy()
    expect(screen.getByText('Alt + 1..9')).toBeTruthy()
  })

  it('closes via the button and the backdrop, but not when clicking inside', () => {
    const onClose = vi.fn()
    const { container } = render(<ShortcutSheet onClose={onClose} />)

    fireEvent.click(screen.getByText('关闭 (Esc)'))
    expect(onClose).toHaveBeenCalledTimes(1)

    // Clicking the panel must not close.
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)

    // The backdrop is the outermost fixed container.
    fireEvent.click(container.firstElementChild as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
