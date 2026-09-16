// @vitest-environment jsdom
/**
 * ThinkingBlock — collapsible reasoning renderer.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

import { ThinkingBlock } from '../../../src/renderer/src/components/ThinkingBlock'

afterEach(() => {
  cleanup()
})

describe('ThinkingBlock', () => {
  it('renders nothing for empty or whitespace-only content', () => {
    const { container: c1 } = render(<ThinkingBlock content="" />)
    expect(c1.querySelector('[data-testid="markdown"]')).toBeNull()

    const { container: c2 } = render(<ThinkingBlock content="   \n  " />)
    expect(c2.querySelector('[data-testid="markdown"]')).toBeNull()
  })

  it('renders the reasoning content once available', async () => {
    render(<ThinkingBlock content="先分析条件，再求解。" />)
    expect(await screen.findByText('先分析条件，再求解。')).toBeTruthy()
  })
})
