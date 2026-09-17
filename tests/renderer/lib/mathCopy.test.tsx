// @vitest-environment jsdom
/**
 * mathCopy — copying rendered math restores the LaTeX source, not the
 * flattened KaTeX text (full, partial and non-math selections).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ClipboardEvent } from 'react'
import { rehypeTexSource, handleCopyMathSource } from '../../../src/renderer/src/lib/mathCopy'

const writeText = vi.fn(async () => {})

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  document.body.innerHTML = ''
})

afterEach(() => {
  window.getSelection()?.removeAllRanges()
})

function select(node: Node, start = 0, end?: number): void {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end ?? (node.nodeType === Node.TEXT_NODE ? (node.nodeValue?.length ?? 0) : node.childNodes.length))
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
}

function copyEvent(): { event: ClipboardEvent; preventDefault: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn()
  return { event: { preventDefault } as unknown as ClipboardEvent, preventDefault }
}

describe('rehypeTexSource', () => {
  it('annotates math elements with their raw TeX source', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['math', 'math-inline'] },
          children: [{ type: 'text', value: 'x^2' }]
        },
        {
          type: 'element',
          tagName: 'div',
          properties: { className: ['math', 'math-display'] },
          children: [
            { type: 'text', value: '\\int' },
            { type: 'text', value: ' f dx' }
          ]
        }
      ]
    }

    rehypeTexSource()(tree)

    const [inline, display] = tree.children as Array<{ properties: Record<string, unknown> }>
    expect(inline.properties.dataTex).toBe('x^2')
    expect(display.properties.dataTex).toBe('\\int f dx')
  })

  it('ignores non-math elements and non-object input', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'element', tagName: 'p', properties: {}, children: [] }]
    }
    expect(() => rehypeTexSource()(tree)).not.toThrow()
    expect((tree.children[0] as { properties: Record<string, unknown> }).properties.dataTex).toBeUndefined()
    expect(() => rehypeTexSource()(null)).not.toThrow()
  })
})

describe('handleCopyMathSource', () => {
  it('copies the whole selection with math elements replaced by their source', () => {
    document.body.innerHTML =
      '<p id="root">看这个 <span data-tex="x^2" class="math math-inline">x2</span> 和 <span data-tex="\\int f" class="math math-display">∫f</span> 公式</p>'
    const root = document.getElementById('root')!
    select(root)
    const { event, preventDefault } = copyEvent()

    handleCopyMathSource(event)

    expect(preventDefault).toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith('看这个 $x^2$ 和 $$\n\\int f\n$$ 公式')
  })

  it('copies only the formula when the selection is inside a single one', () => {
    document.body.innerHTML = `<p id="root"><span data-tex="a+b" class="math math-inline">a+b</span></p>`
    const span = document.querySelector('[data-tex]')!
    select(span.firstChild!, 1, 2) // partial selection inside the formula
    const { event, preventDefault } = copyEvent()

    handleCopyMathSource(event)

    expect(preventDefault).toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith('$a+b$')
  })

  it('does nothing for collapsed or non-math selections', () => {
    document.body.innerHTML = `<p id="plain">纯文本</p>`
    const p = document.getElementById('plain')!

    // Collapsed selection.
    select(p.firstChild!, 0, 0)
    handleCopyMathSource(copyEvent().event)
    expect(writeText).not.toHaveBeenCalled()

    // Non-math selection → the browser default copy applies.
    select(p.firstChild!)
    const { event, preventDefault } = copyEvent()
    handleCopyMathSource(event)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('keeps the formula source when the selection runs from math into plain text', () => {
    document.body.innerHTML =
      '<p id="root"><span data-tex="x^2" class="math math-inline">x2</span> 尾巴</p>'
    const root = document.getElementById('root')!
    const range = document.createRange()
    range.setStart(root.querySelector('[data-tex]')!.firstChild!, 1)
    range.setEnd(root.lastChild!, 2)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    const { event, preventDefault } = copyEvent()

    handleCopyMathSource(event)

    // The cloned fragment carries the (partial) math element → its source is
    // restored for the copied text.
    expect(preventDefault).toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('$x^2$'))
  })
})
