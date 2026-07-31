import { describe, it, expect } from 'vitest'
import {
  parseFlashcards,
  rebuildArtifactContent,
  buildAnkiImport,
  toAnkiText,
  sanitizeDeck
} from '../../src/shared/flashcard-utils'

const SAMPLE = [
  '- 问题：什么是不确定性原理？',
  '- 答案：位置与动量无法同时被精确测定。',
  '',
  '- 问题：薛定谔方程描述什么？',
  '  补充：方程的物理意义',
  '- 答案：波函数随时间的演化。',
  '  波函数的模平方对应概率密度。'
].join('\n')

describe('parseFlashcards', () => {
  it('parses 问题/答案 pairs and multi-line continuations', () => {
    const cards = parseFlashcards(SAMPLE)
    expect(cards).toHaveLength(2)
    expect(cards[0]).toEqual({
      question: '什么是不确定性原理？',
      answer: '位置与动量无法同时被精确测定。'
    })
    expect(cards[1].question).toBe('薛定谔方程描述什么？\n补充：方程的物理意义')
    expect(cards[1].answer).toBe('波函数随时间的演化。\n波函数的模平方对应概率密度。')
  })

  it('returns an empty list for empty content', () => {
    expect(parseFlashcards('')).toEqual([])
  })
})

describe('rebuildArtifactContent', () => {
  it('round-trips parsed cards back to a parseable format', () => {
    const original = parseFlashcards(SAMPLE)
    const rebuilt = rebuildArtifactContent(original)
    expect(parseFlashcards(rebuilt)).toEqual(original)
  })

  it('preserves card order and content after an edit', () => {
    const cards = parseFlashcards(SAMPLE)
    cards[0] = { question: '修正后的问题？', answer: '修正后的答案。' }
    const reparsed = parseFlashcards(rebuildArtifactContent(cards))
    expect(reparsed[0]).toEqual({ question: '修正后的问题？', answer: '修正后的答案。' })
    expect(reparsed[1]).toEqual(cards[1])
  })
})

describe('Anki export', () => {
  it('builds a tab-separated import file with deck and tags', () => {
    const out = buildAnkiImport([
      {
        question: '什么是不确定性原理？',
        answer: '位置与动量无法同时被精确测定。',
        conversationTitle: '物理：量子入门',
        createdAt: '2026-07-06T12:00:00.000Z'
      }
    ])
    expect(out.startsWith('#separator:tab')).toBe(true)
    expect(out).toContain('#html:true')
    expect(out).toContain('#deck column:3')
    expect(out).toContain('#tags column:4')
    expect(out).toContain('Sophia::物理：量子入门')
    expect(out).toContain('sophia 2026-07')
  })

  it('escapes tabs and converts newlines to <br>', () => {
    expect(toAnkiText('a\tb\nc')).toBe('a b<br>c')
  })

  it('sanitizes deck names', () => {
    expect(sanitizeDeck('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })
})
