import { describe, it, expect } from 'vitest'
import {
  splitSections,
  extractTerms,
  retrievePassages,
  formatPassages,
  headingMatches,
  extractRegionAroundProgress
} from '../../../src/main/prompt/textbook-retrieval'

const TEXTBOOK = `# 前言

本书介绍量子力学的基础知识，适合初学者。

## 第一章 波粒二象性

波动性和粒子性是微观粒子的基本属性。
光的干涉实验有力地证明了波动性的一面。

## 第二章 不确定性原理

海森堡不确定性原理说明：位置与动量无法同时被精确测定。
测量的行为本身会扰动被测系统。

## 第三章 薛定谔方程

薛定谔方程描述了波函数随时间的演化。
波函数的模平方对应粒子出现的概率密度。
`

describe('splitSections', () => {
  it('splits by markdown headings and keeps a preamble section', () => {
    const sections = splitSections(TEXTBOOK)
    expect(sections).toHaveLength(4)
    expect(sections[0].heading).toBe('前言')
    expect(sections[1].heading).toBe('第一章 波粒二象性')
    expect(sections[2].heading).toBe('第二章 不确定性原理')
    expect(sections[3].heading).toBe('第三章 薛定谔方程')
    expect(sections[2].text).toContain('位置与动量')
  })

  it('returns an empty list for empty content', () => {
    expect(splitSections('')).toEqual([])
  })
})

describe('extractTerms', () => {
  it('produces CJK bigrams/trigrams and filters stopwords', () => {
    const terms = extractTerms(['为什么位置和动量不能同时确定？'])
    expect(terms).toContain('位置')
    expect(terms).toContain('动量')
    expect(terms).toContain('确定')
    expect(terms).not.toContain('为什么')
  })

  it('extracts latin word tokens in lowercase', () => {
    const terms = extractTerms(['What about the Schrödinger Equation?'])
    expect(terms).toContain('schr')
    expect(terms).toContain('equation')
  })
})

describe('retrievePassages', () => {
  it('finds the chapter that actually discusses the topic', () => {
    const passages = retrievePassages(
      TEXTBOOK,
      ['为什么位置和动量不能同时精确测定？']
    )
    expect(passages.length).toBeGreaterThan(0)
    expect(passages[0].heading).toBe('第二章 不确定性原理')
    expect(passages[0].excerpt).toContain('位置与动量')
  })

  it('drops corpus-wide terms that appear in every section', () => {
    const everySection = `## 第一章 量子入门
量子的概念贯穿全书第一章的内容。

## 第二章 量子发展
量子理论在第二章继续推进。

## 第三章 量子应用
量子应用在第三章展开。`
    const passages = retrievePassages(everySection, ['量子'])
    expect(passages).toEqual([])
  })

  it('caps the number of passages', () => {
    const passages = retrievePassages(
      TEXTBOOK,
      ['量子力学 波函数 概率密度 干涉实验 不确定性原理'],
      { maxPassages: 2 }
    )
    expect(passages.length).toBeLessThanOrEqual(2)
  })
})

describe('formatPassages', () => {
  it('includes chapter headings, the textbook title and a citation rule', () => {
    const out = formatPassages(
      [{ heading: '第二章 不确定性原理', excerpt: '位置与动量无法同时被精确测定。' }],
      '量子力学入门'
    )
    expect(out).toContain('《量子力学入门》')
    expect(out).toContain('第二章 不确定性原理')
    expect(out).toContain('位置与动量无法同时被精确测定')
    expect(out).toContain('绝不编造教材没有的内容')
  })
})

describe('headingMatches', () => {
  it('matches identical headings', () => {
    expect(headingMatches('第二章 不确定性原理', '第二章 不确定性原理')).toBe(true)
  })

  it('ignores chapter numbering and punctuation', () => {
    expect(headingMatches('第二章：不确定性原理', '第二章 不确定性原理')).toBe(true)
    expect(headingMatches('不确定性原理', '第二章 不确定性原理')).toBe(true)
    expect(headingMatches('不确定性原理', '第二章 不确定性原理。')).toBe(true)
  })

  it('rejects unrelated headings', () => {
    expect(headingMatches('不确定性原理', '第一章 波粒二象性')).toBe(false)
    expect(headingMatches('', '第一章 波粒二象性')).toBe(false)
  })
})

describe('extractRegionAroundProgress', () => {
  it('starts from the beginning without progress info', () => {
    const region = extractRegionAroundProgress(TEXTBOOK, null)
    expect(region).toContain('前言')
    expect(region).toContain('第一章')
  })

  it('starts near the given fraction and keeps later sections', () => {
    const region = extractRegionAroundProgress(TEXTBOOK, 0.5)
    // 4 sections, fraction 0.5 → section index 2 = 第二章
    expect(region).toContain('第二章')
    expect(region).toContain('第三章')
  })

  it('respects the token budget', () => {
    const long = Array.from(
      { length: 50 },
      (_, i) => `## 第${i}章\n\n内容${'很长的内容'.repeat(100)}\n`
    ).join('\n')
    const region = extractRegionAroundProgress(long, 0, 500)
    const count = (region.match(/## 第\d+章/g) || []).length
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(50)
  })

  it('returns empty for empty content', () => {
    expect(extractRegionAroundProgress('', 0.5)).toBe('')
  })
})

describe('textbook-retrieval — fuzzy and degenerate inputs', () => {
  it('matches on shared 4-gram fragments', () => {
    // Neither heading contains the other, but they share a 4-gram.
    expect(headingMatches('abcdefgh', 'xabcdey')).toBe(true)
  })

  it('rejects blank headings and unrelated ones without shared n-grams', () => {
    expect(headingMatches('', '第一章')).toBe(false)
    expect(headingMatches('第一章', '')).toBe(false)
    expect(headingMatches('abcd', 'wxyz')).toBe(false)
  })

  it('ignores single-character CJK runs when extracting terms', () => {
    expect(extractTerms(['字'])).toEqual([])
  })

  it('returns no passages for content without sections or without usable terms', () => {
    expect(retrievePassages('', ['anything'])).toEqual([])
    expect(retrievePassages('# 第一章\n\n正文内容', [''])).toEqual([])
  })

  it('skips duplicate section headings across passages', () => {
    const content = [
      '# 练习',
      '',
      '关于熵的练习一，熵是状态函数。',
      '',
      '# 练习',
      '',
      '关于熵的练习二，状态函数不会减少。',
      '',
      '# 熵与热力学',
      '',
      '熵增原理说明孤立系统的熵不减少。',
      '',
      '# 温度',
      '',
      '温度是分子平均动能的度量。',
      '',
      '# 压强',
      '',
      '压强来自分子对器壁的碰撞。',
      '',
      '# 体积',
      '',
      '体积随温度与压强变化。'
    ].join('\n')

    const passages = retrievePassages(content, ['熵 状态函数 熵增'], { maxPassages: 3 })

    const headings = passages.map((p) => p.heading)
    expect(new Set(headings).size).toBe(headings.length)
    expect(headings.filter((h) => h === '练习')).toHaveLength(1)
  })

  it('truncates an oversized matching paragraph to the excerpt budget', () => {
    const longParagraph = '状态函数 ' + 'x'.repeat(500)
    const content = [
      `# 第一章\n\n${longParagraph}`,
      '',
      '# 第二章',
      '',
      '温度是分子平均动能的度量。',
      '',
      '# 第三章',
      '',
      '压强来自分子对器壁的碰撞。',
      '',
      '# 第四章',
      '',
      '体积随温度与压强变化。'
    ].join('\n')

    const passages = retrievePassages(content, ['状态函数'], { maxExcerptChars: 30 })

    expect(passages).toHaveLength(1)
    expect(passages[0].excerpt.length).toBeLessThanOrEqual(30)
  })

  it('keeps an earlier fitting paragraph when a later hit overflows the excerpt', () => {
    const content = [
      '# 第一章',
      '',
      '短句提到状态函数。',
      '',
      '第二段也讲状态函数，' + '内容很长'.repeat(40) + '。',
      '',
      '# 第二章',
      '',
      '温度是分子平均动能的度量。',
      '',
      '# 第三章',
      '',
      '压强来自分子对器壁的碰撞。',
      '',
      '# 第四章',
      '',
      '体积随温度与压强变化。'
    ].join('\n')

    const passages = retrievePassages(content, ['状态函数'], { maxExcerptChars: 30 })

    expect(passages).toHaveLength(1)
    expect(passages[0].excerpt).toContain('短句提到状态函数')
    expect(passages[0].excerpt).not.toContain('第二段')
  })
})

describe('formatPassages — title fallback', () => {
  it('uses 教材 when no textbook title is given', () => {
    const out = formatPassages([{ heading: '第一章', excerpt: '正文内容' }])

    expect(out).toContain('【相关教材段落 1 · 教材 · 第一章】')
    expect(out).toContain('【教材出处 · 教材 · 章节名】')
  })
})
