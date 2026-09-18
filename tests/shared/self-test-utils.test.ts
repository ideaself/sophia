import { describe, it, expect } from 'vitest'
import { parseSelfTestQuestions } from '../../src/shared/self-test-utils'

const SAMPLE = [
  '## 课堂总结',
  '',
  '**自测 1：什么是熵？**',
  '- 提示 1：想想「有序」与「无序」。',
  '- 提示 2：与能量在系统中的分布有关。',
  '- 答案：系统无序程度的度量。',
  '',
  '**自测 2：热力学第二定律说了什么？**',
  '- 提示 1：它描述了一个方向。',
  '- 答案：孤立系统的熵不会自发减少。',
  '',
  '以上就是全部自测题。'
].join('\n')

describe('parseSelfTestQuestions', () => {
  it('parses questions with hints and answers', () => {
    const questions = parseSelfTestQuestions(SAMPLE)
    expect(questions).toHaveLength(2)
    expect(questions[0]).toEqual({
      question: '什么是熵？',
      hints: ['想想「有序」与「无序」。', '与能量在系统中的分布有关。'],
      answer: '系统无序程度的度量。'
    })
    expect(questions[1].hints).toHaveLength(1)
    expect(questions[1].answer).toBe('孤立系统的熵不会自发减少。')
  })

  it('returns an empty list when there are no self-test questions', () => {
    expect(parseSelfTestQuestions('## 课堂总结\n\n今天讨论了波粒二象性。')).toEqual([])
  })

  it('keeps continuation lines within a field', () => {
    const out = parseSelfTestQuestions(
      '**自测 1：为什么？**\n- 答案：第一行。\n  第二行。'
    )
    expect(out).toHaveLength(1)
    expect(out[0].answer).toBe('第一行。\n第二行。')
  })

  it('ignores indented prose before the first hint or answer', () => {
    const out = parseSelfTestQuestions(
      '**自测 1：什么是熵？**\n  一句没有字段的缩进说明。\n- 答案：无序度的度量。'
    )
    expect(out).toHaveLength(1)
    expect(out[0].hints).toEqual([])
    expect(out[0].answer).toBe('无序度的度量。')
  })
})


describe('parseSelfTestQuestions (课堂测验卡)', () => {
  it('parses 考考我 quick-action replies with intro prose', () => {
    const out = parseSelfTestQuestions('好的，出一道题检验你：\n\n**自测 1：复数 z = 3 + 4i 的模长是多少？**\n- 提示 1：勾股定理。\n- 提示 2：模长是 sqrt(a² + b²)。\n- 答案：5。')
    expect(out).toHaveLength(1)
    expect(out[0].question).toBe('复数 z = 3 + 4i 的模长是多少？')
    expect(out[0].hints).toHaveLength(2)
    expect(out[0].answer).toBe('5。')
  })

  it('parses two questions in one reply', () => {
    const out = parseSelfTestQuestions('**自测 1：1+1=？**\n- 答案：2。\n\n**自测 2：2+2=？**\n- 答案：4。')
    expect(out).toHaveLength(2)
    expect(out[1].answer).toBe('4。')
  })

  it('leaves answers in trailing prose out of the questions', () => {
    const out = parseSelfTestQuestions('**自测 1：什么是导数？**\n- 答案：瞬时变化率。\n\n你都答对了吗？')
    expect(out).toHaveLength(1)
    expect(out[0].answer).toBe('瞬时变化率。')
  })
})
