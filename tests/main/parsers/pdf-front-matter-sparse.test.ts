/**
 * pdf-front-matter — the sparse-page heuristics (roman numerals, low prose
 * ratio, blank pages, comma-terminated long lines).
 */
import { describe, it, expect } from 'vitest'

import { findBodyStartPage } from '../../../src/main/parsers/pdf-front-matter'

describe('findBodyStartPage — sparse page heuristics', () => {
  it('skips blank pages entirely', () => {
    const pages = ['   \n\n  ', '第一章 温度\n熵是状态函数，孤立系统的熵永不减少，这一结论被称为熵增原理。熵是状态函数，孤立系统的熵永不减少，这一结论被称为熵增原理。']

    expect(findBodyStartPage(pages)).toBe(1)
  })

  it('treats roman-numeral page numbers as front matter', () => {
    // A short page carrying a roman numeral and no prose.
    const pages = ['前言\nIV\n目录条目一\n目录条目二', '第一章 熵\n熵是状态函数，孤立系统的熵永不减少，这一结论被称为熵增原理。熵是状态函数，孤立系统的熵永不减少，这一结论被称为熵增原理。']

    expect(findBodyStartPage(pages)).toBe(1)
  })

  it('skips pages whose prose ratio is below the threshold', () => {
    // Two lines of short, punctuation-free fragments → ratio 0.
    const pages = ['第一章\n图 1-1', '第一章 熵\n熵是状态函数，孤立系统的熵永不减少，这一结论被称为熵增原理。熵是状态函数，孤立系统的熵永不减少，这一结论被称为熵增原理。']

    expect(findBodyStartPage(pages)).toBe(1)
  })

  it('counts long comma-heavy lines as prose', () => {
    const commaLine =
      '这是一行很长的、包含多个逗号的、没有以句号结尾的、但仍然属于散文的正文内容行，用来验证逗号也能计入散文比例'
    const pages = [
      `${commaLine}\n${commaLine}\n${commaLine}`,
      '第一章 熵\n熵是状态函数，孤立系统的熵永不减少，这一结论被称为熵增原理。熵是状态函数，孤立系统的熵永不减少，这一结论被称为熵增原理。'
    ]

    // The first page reads as prose → it is the body start.
    expect(findBodyStartPage(pages)).toBe(0)
  })

  it('returns 0 when every page looks like front matter', () => {
    const pages = ['书名\n作者', '版权\n© 2026', '目录\n第一章 … 1']

    expect(findBodyStartPage(pages)).toBe(0)
  })

  it('skips a short page whose only roman numeral is a strong front-matter hint', () => {
    // 3 lines, no front-matter keyword, under 1200 chars, roman numeral present.
    const pages = ['Alpha\nBeta\nIV', '第一章 熵\n熵是状态函数，孤立系统的熵永不减少，这一结论被称为熵增原理。熵是状态函数，孤立系统的熵永不减少，这一结论被称为熵增原理。']

    expect(findBodyStartPage(pages)).toBe(1)
  })

  it('keeps a long prose page even when it contains a roman numeral', () => {
    const line = 'Section IV explains why repeated observation and measurement matter. '.repeat(8).trimEnd()
    const pages = [`${line}\n${line}\n${line}`, '第一章 熵\n熵是状态函数，孤立系统的熵永不减少，这一结论被称为熵增原理。熵是状态函数，孤立系统的熵永不减少，这一结论被称为熵增原理。']

    expect(findBodyStartPage(pages)).toBe(0)
  })
})
