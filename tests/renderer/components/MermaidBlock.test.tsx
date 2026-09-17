// @vitest-environment jsdom
/**
 * MermaidBlock — lazy mermaid rendering: success injects the SVG, failure
 * falls back to a plain code block, unmount never touches the DOM.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'

const state = vi.hoisted(() => ({
  render: vi.fn(),
  resolveGate: null as Promise<void> | null
}))

vi.mock('../../../src/renderer/src/lib/mermaid', () => ({
  loadMermaid: async () => ({
    default: {
      render: async (id: string, code: string) => {
        if (state.resolveGate) await state.resolveGate
        return state.render(id, code)
      }
    }
  })
}))

import { MermaidBlock } from '../../../src/renderer/src/components/MermaidBlock'

beforeEach(() => {
  state.render.mockReset().mockResolvedValue({ svg: '<svg id="diagram">ok</svg>' })
  state.resolveGate = null
})

afterEach(cleanup)

describe('MermaidBlock', () => {
  it('renders the diagram SVG into the container', async () => {
    const { container } = render(<MermaidBlock code="graph TD; A-->B" />)

    await waitFor(() => expect(container.querySelector('svg')).toBeTruthy())
    expect(state.render).toHaveBeenCalledWith(
      expect.stringMatching(/^mermaid-/),
      'graph TD; A-->B'
    )
    expect(container.querySelector('#diagram')?.textContent).toBe('ok')
  })

  it('falls back to a code block when mermaid fails', async () => {
    state.render.mockRejectedValue(new Error('parse error'))

    render(<MermaidBlock code="not a diagram" />)

    const fallback = await screen.findByText('not a diagram')
    expect(fallback.tagName).toBe('CODE')
    expect(fallback.closest('pre')?.className).toContain('text-red-400')
  })

  it('does not touch the DOM when unmounted before the render resolves', async () => {
    let release!: () => void
    state.resolveGate = new Promise<void>((resolve) => {
      release = resolve
    })

    const view = render(<MermaidBlock code="graph TD; A-->B" />)
    view.unmount()
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(document.querySelector('svg')).toBeNull()
    expect(screen.queryByText(/graph TD/)).toBeNull()
  })
})
