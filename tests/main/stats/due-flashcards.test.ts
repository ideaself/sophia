import { describe, it, expect } from 'vitest'

import { countDueFlashcards } from '../../../src/main/stats/due-flashcards'

const CONTENT_TWO_CARDS = [
  '- 问题：什么是卷积？',
  '- 答案：一种积分运算',
  '- 问题：傅里叶变换的作用？',
  '- 答案：时频转换'
].join('\n')

describe('countDueFlashcards', () => {
  it('counts new cards (no SRS state) as due', () => {
    const result = countDueFlashcards(
      [{ id: 'art_1', type: 'flashcards', content: CONTENT_TWO_CARDS }],
      {},
      1000
    )
    expect(result).toEqual({ due: 2, total: 2 })
  })

  it('respects scheduled review times', () => {
    const artifacts = [{ id: 'art_1', type: 'flashcards', content: CONTENT_TWO_CARDS }]
    const states = {
      art_1_0: { nextReview: 2000 }, // future → not due
      art_1_1: { nextReview: 500 }   // past → due
    }
    expect(countDueFlashcards(artifacts, states, 1000)).toEqual({ due: 1, total: 2 })
  })

  it('treats nextReview === 0 (new) as due', () => {
    const artifacts = [{ id: 'art_1', type: 'flashcards', content: CONTENT_TWO_CARDS }]
    const states = {
      art_1_0: { nextReview: 0 },
      art_1_1: { nextReview: 500 }
    }
    expect(countDueFlashcards(artifacts, states, 1000)).toEqual({ due: 2, total: 2 })
  })

  it('ignores non-flashcard artifacts', () => {
    const result = countDueFlashcards(
      [
        { id: 'art_1', type: 'lesson_summary', content: CONTENT_TWO_CARDS },
        { id: 'art_2', type: 'flashcards', content: CONTENT_TWO_CARDS }
      ],
      {},
      1000
    )
    expect(result).toEqual({ due: 2, total: 2 })
  })

  it('handles empty input', () => {
    expect(countDueFlashcards([], {}, 1000)).toEqual({ due: 0, total: 0 })
  })
})
