import { describe, it, expect } from 'vitest'
import { applyNotesToHtml, escapeHtml } from '../../src/shared/reading-notes-utils'

describe('applyNotesToHtml', () => {
  it('wraps a highlight in a mark tag with data-note', () => {
    const out = applyNotesToHtml(
      '<p>波粒二象性是量子力学的基础。</p>',
      [{ id: 'rn1', position: '0', type: 'highlight', content: '波粒二象性' }],
      0
    )
    expect(out).toContain('<mark data-note="rn1" style="background-color:rgba(255,213,79,0.45)">波粒二象性</mark>')
  })

  it('wraps an underline in a u tag', () => {
    const out = applyNotesToHtml(
      '<p>位置与动量无法同时精确测定。</p>',
      [{ id: 'rn2', position: '0', type: 'underline', content: '位置与动量' }],
      0
    )
    expect(out).toContain('<u data-note="rn2" style="text-decoration:underline;')
  })

  it('only applies notes belonging to the current chapter', () => {
    const out = applyNotesToHtml(
      '<p>第一章的内容。</p>',
      [
        { id: 'a', position: '0', type: 'highlight', content: '第一章' },
        { id: 'b', position: '1', type: 'highlight', content: '第一章' }
      ],
      1
    )
    expect((out.match(/<mark/g) || []).length).toBe(1)
    expect(out).toContain('data-note="b"')
    expect(out).not.toContain('data-note="a"')
  })

  it('escapes the note text to match HTML entities', () => {
    const out = applyNotesToHtml(
      '<p>a &amp; b 与 c &lt; d</p>',
      [{ id: 'c', position: '0', type: 'highlight', content: 'a & b 与 c < d' }],
      0
    )
    expect(out).toContain('<mark data-note="c"')
  })

  it('leaves the html untouched when the text is not found', () => {
    const html = '<p>不相关的段落。</p>'
    expect(applyNotesToHtml(html, [{ id: 'x', position: '0', type: 'highlight', content: '没有这个词' }], 0)).toBe(html)
  })
})

describe('escapeHtml', () => {
  it('escapes & < > "', () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;')
  })
})
