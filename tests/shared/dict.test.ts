import { describe, it, expect } from 'vitest'
import { buildDictUrl, isEnglishWord, DEFAULT_DICT_TEMPLATE } from '../../src/shared/dict'

describe('buildDictUrl', () => {
  it('replaces the {word} placeholder with a URL-encoded word', () => {
    expect(buildDictUrl(DEFAULT_DICT_TEMPLATE, 'hello')).toBe(
      'https://dict.youdao.com/result?word=hello&lang=en'
    )
    expect(buildDictUrl(DEFAULT_DICT_TEMPLATE, 'türbo')).toBe(
      'https://dict.youdao.com/result?word=t%C3%BCrbo&lang=en'
    )
  })

  it('falls back to the default template when {word} is missing', () => {
    expect(buildDictUrl('https://example.com?q=abc', 'hello')).toBe(
      'https://dict.youdao.com/result?word=hello&lang=en'
    )
  })
})

describe('isEnglishWord', () => {
  it('accepts plain English words', () => {
    expect(isEnglishWord('hello')).toBe(true)
    expect(isEnglishWord('Socratic')).toBe(true)
    expect(isEnglishWord("don't")).toBe(true)
    expect(isEnglishWord('well-known')).toBe(true)
  })

  it('rejects multi-word selections, empty text and non-ASCII', () => {
    expect(isEnglishWord('hello world')).toBe(false)
    expect(isEnglishWord('')).toBe(false)
    expect(isEnglishWord('你好')).toBe(false)
    expect(isEnglishWord('123abc')).toBe(false)
    // > 64 chars
    expect(isEnglishWord('a'.repeat(65))).toBe(false)
  })
})
