// @vitest-environment jsdom
/**
 * applySearchMarksToHtml — controlled search highlighting for the EPUB reader.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { applySearchMarksToHtml } from '../../../src/renderer/src/reader/epub-search-marks'

afterEach(() => {
  document.body.innerHTML = ''
})

function parse(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

describe('applySearchMarksToHtml', () => {
  it('wraps every case-insensitive match with data-search marks', () => {
    const result = applySearchMarksToHtml('<p>卷积是卷积的运算</p>', '卷积')

    expect(result.count).toBe(2)
    const host = parse(result.html)
    const marks = host.querySelectorAll('mark[data-search="1"]')
    expect(marks).toHaveLength(2)
    expect(marks[0].textContent).toBe('卷积')
    expect(host.textContent).toBe('卷积是卷积的运算')
  })

  it('returns the html untouched for an empty query', () => {
    const html = '<p>卷积</p>'
    expect(applySearchMarksToHtml(html, '')).toEqual({ html, count: 0 })
    expect(applySearchMarksToHtml(html, '   ')).toEqual({ html, count: 0 })
    expect(applySearchMarksToHtml('', '卷积')).toEqual({ html: '', count: 0 })
  })

  it('never matches text inside attributes or tags', () => {
    const html = '<p class="convolution" data-note="n1">卷积</p>'
    const result = applySearchMarksToHtml(html, 'convolution')

    expect(result.count).toBe(0)
    expect(result.html).toBe(html)
  })

  it('skips text already inside a note mark', () => {
    const html = '<p><mark data-note="n1">卷积</mark> 之外</p>'
    const result = applySearchMarksToHtml(html, '卷积')

    expect(result.count).toBe(0)
    expect(parse(result.html).querySelectorAll('[data-note]')).toHaveLength(1)
  })

  it('marks matches across sibling text nodes without nesting', () => {
    const result = applySearchMarksToHtml('<p>a<b>b</b>abc</p>', 'ab')

    expect(result.count).toBe(1)
    const host = parse(result.html)
    expect(host.querySelectorAll('mark[data-search="1"]')).toHaveLength(1)
    expect(host.textContent).toBe('ababc')
  })

  it('finds adjacent non-overlapping matches left to right', () => {
    const result = applySearchMarksToHtml('<p>aaaa</p>', 'aa')

    expect(result.count).toBe(2)
    expect(parse(result.html).querySelectorAll('mark[data-search="1"]')).toHaveLength(2)
  })

  it('keeps surrounding markup intact', () => {
    const result = applySearchMarksToHtml(
      '<p>前 <em>卷积</em> 后</p><p>无匹配段</p>',
      '卷积'
    )

    const host = parse(result.html)
    expect(host.querySelectorAll('em')).toHaveLength(1)
    expect(host.querySelector('em mark')?.textContent).toBe('卷积')
    expect(host.querySelectorAll('p')).toHaveLength(2)
  })
})
