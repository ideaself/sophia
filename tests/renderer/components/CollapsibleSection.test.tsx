// @vitest-environment jsdom
/**
 * CollapsibleSection — settings section disclosure semantics.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { CollapsibleSection } from '../../../src/renderer/src/components/CollapsibleSection'

afterEach(() => {
  cleanup()
})

describe('CollapsibleSection', () => {
  it('is collapsed by default and exposes aria-expanded', () => {
    render(
      <CollapsibleSection title="模型服务">
        <p>内容</p>
      </CollapsibleSection>
    )

    const button = screen.getByRole('button', { name: /模型服务/ })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('内容')).toBeNull()
    expect(screen.getByText('展开')).toBeTruthy()
  })

  it('expands and collapses, keeping aria-expanded in sync', () => {
    render(
      <CollapsibleSection title="模型服务" defaultOpen>
        <p>内容</p>
      </CollapsibleSection>
    )

    const button = screen.getByRole('button', { name: /模型服务/ })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('内容')).toBeTruthy()

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('内容')).toBeNull()

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('内容')).toBeTruthy()
  })

  it('links the toggle to its content region', () => {
    render(
      <CollapsibleSection title="模型服务" defaultOpen>
        <p>内容</p>
      </CollapsibleSection>
    )
    const button = screen.getByRole('button', { name: /模型服务/ })
    const controls = button.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    expect(document.getElementById(controls!)).toBeTruthy()
  })
})
