import { describe, it, expect } from 'vitest'
import {
  splitSections,
  extractTerms,
  retrievePassages,
  formatPassages
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
