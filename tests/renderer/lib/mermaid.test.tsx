// @vitest-environment jsdom
/**
 * lib/mermaid — lazy load + one-time initialization, and the MarkdownRenderer
 * code-block branch that routes mermaid fences to MermaidBlock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg id="z"></svg>' }))
}))

vi.mock('mermaid', () => ({
  default: mermaid
}))

vi.mock('../../../src/renderer/src/components/MermaidBlock', () => ({
  MermaidBlock: ({ code }: { code: string }) => <div data-testid="mermaid">mermaid:{code}</div>
}))

import { loadMermaid } from '../../../src/renderer/src/lib/mermaid'
import MarkdownRenderer from '../../../src/renderer/src/lib/MarkdownRenderer'

beforeEach(() => {
  mermaid.initialize.mockClear()
})

afterEach(cleanup)

describe('loadMermaid', () => {
  it('initializes mermaid once and reuses the promise', async () => {
    const first = loadMermaid()
    const second = loadMermaid()

    expect(first).toBe(second)
    const mod = await first
    expect(mod.default).toBe(mermaid)
    expect(mermaid.initialize).toHaveBeenCalledTimes(1)
    expect(mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose'
    })
  })
})

describe('MarkdownRenderer mermaid routing', () => {
  it('routes mermaid fences to MermaidBlock and leaves other code blocks alone', async () => {
    render(
      <MarkdownRenderer>
        {'```mermaid\ngraph TD; A-->B\n```\n\n```js\nconst a = 1\n```'}
      </MarkdownRenderer>
    )

    const block = await screen.findByTestId('mermaid')
    expect(block.textContent).toContain('graph TD; A-->B')
    // Non-mermaid fences still render as plain code (highlighting may split spans).
    expect(document.body.textContent).toContain('const a = 1')
  })
})
