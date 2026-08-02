import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildDictUrl,
  isEnglishWord,
  DEFAULT_DICT_TEMPLATE,
  loadDictPopupPrefs,
  saveDictPopupPrefs,
  DEFAULT_DICT_POPUP_PREFS
} from '../../src/shared/dict'

// Node test env has no localStorage — provide a minimal in-memory stub.
const storage = new Map<string, string>()
if (typeof globalThis.localStorage === 'undefined') {
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, v) },
    removeItem: (k: string) => { storage.delete(k) },
    clear: () => { storage.clear() }
  }
}

beforeEach(() => {
  localStorage.clear()
})

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

describe('dict popup prefs', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadDictPopupPrefs()).toEqual(DEFAULT_DICT_POPUP_PREFS)
  })

  it('persists and restores size + zoom', () => {
    saveDictPopupPrefs({ width: 760, height: 560, zoom: 0.7 })
    expect(loadDictPopupPrefs()).toEqual({ width: 760, height: 560, zoom: 0.7 })
  })

  it('clamps invalid stored values back to defaults', () => {
    saveDictPopupPrefs({ width: 100, height: 9999, zoom: 3 } as never)
    expect(loadDictPopupPrefs()).toEqual(DEFAULT_DICT_POPUP_PREFS)
  })
})
