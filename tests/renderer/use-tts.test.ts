import { describe, it, expect } from 'vitest'
import { stripMarkdown } from '../../src/shared/tts-utils'

describe('stripMarkdown', () => {
  it('removes headings, bold, italic and inline code', () => {
    expect(stripMarkdown('## 标题\n\n**加粗** 和 *斜体* 还有 `代码`')).toBe(
      '标题\n\n加粗 和 斜体 还有 代码'
    )
  })

  it('strips lists, blockquotes, links and table pipes', () => {
    expect(
      stripMarkdown('- 项目一\n- 项目二\n\n> 引用\n\n[链接](https://example.com)\n\n列 | 值')
    ).toBe('项目一\n项目二\n引用\n\n链接\n\n列   值')
  })

  it('collapses runs of more than two newlines', () => {
    expect(stripMarkdown('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('trims surrounding whitespace', () => {
    expect(stripMarkdown('  \n  内容  \n ')).toBe('内容')
  })
})
