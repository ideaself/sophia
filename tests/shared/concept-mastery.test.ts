import { describe, it, expect } from 'vitest'
import {
  buildConceptMasterySegment,
  isWeakConcept,
  masteryTier,
  selectWeakConcepts
} from '../../src/shared/concept-mastery'
import { buildNextSteps } from '../../src/shared/next-steps'

describe('concept-mastery prompt segment', () => {
  it('masteryTier 分档', () => {
    expect(masteryTier(0.8)).toBe('掌握')
    expect(masteryTier(0.5)).toBe('理解')
    expect(masteryTier(0.2)).toBe('薄弱')
  })

  it('挑选薄弱概念：低掌握度或未澄清误解，按掌握度升序且限量', () => {
    expect(isWeakConcept({ mastery: 0.2, misconception: null })).toBe(true)
    expect(isWeakConcept({ mastery: 0.5, misconception: '混淆' })).toBe(true)
    expect(isWeakConcept({ mastery: 0.5, misconception: null })).toBe(false)
    expect(isWeakConcept({ mastery: 0.9, misconception: '旧误解' })).toBe(false)

    const picked = selectWeakConcepts(
      [
        { name: 'A', mastery: 0.6, misconception: '误解' },
        { name: 'B', mastery: 0.9, misconception: null },
        { name: 'C', mastery: 0.1, misconception: null },
        { name: 'D', mastery: 0.3, misconception: null },
        { name: 'E', mastery: 0.2, misconception: null }
      ],
      3
    )
    expect(picked.map((c) => c.name)).toEqual(['C', 'E', 'D'])
  })

  it('空概念返回 null', () => {
    expect(buildConceptMasterySegment([])).toBeNull()
  })

  it('生成按薄弱到掌握排列的提示段', () => {
    const seg = buildConceptMasterySegment([
      { name: '导数', mastery: 0.9, misconception: null },
      { name: '极限', mastery: 0.3, misconception: '把极限当函数值' }
    ])
    expect(seg).not.toBeNull()
    expect(seg!).toContain('## 学习者的概念掌握度')
    expect(seg!).toContain('- 极限：薄弱（掌握度 30%），误解点：把极限当函数值')
    expect(seg!).toContain('- 导数：已掌握（掌握度 90%）')
    expect(seg!.indexOf('极限')).toBeLessThan(seg!.indexOf('导数'))
    expect(seg!).toContain('「薄弱」概念：优先复习巩固')
    expect(seg!).toContain('若某概念标注了误解点，必须先针对误解澄清')
  })
})

describe('next-steps', () => {
  it('无概念返回空建议', () => {
    expect(buildNextSteps([])).toEqual([])
  })

  it('按掌握度档位生成四类建议', () => {
    const steps = buildNextSteps([
      { name: 'A', mastery: 0.2, misconception: null, attemptCount: 2 },
      { name: 'B', mastery: 0.2, misconception: '错误思路', attemptCount: 1 },
      { name: 'C', mastery: 0.5, misconception: null, attemptCount: 3 },
      { name: 'D', mastery: 0.9, misconception: null, attemptCount: 4 }
    ])
    const tiers = steps.map((s) => s.tier)
    expect(tiers[0]).toBe('目标') // 误解优先
    expect(tiers).toContain('薄弱')
    expect(tiers).toContain('理解')
    expect(tiers).toContain('掌握')
    const weak = steps.find((s) => s.tier === '薄弱')
    expect(weak?.concepts).toEqual(['A', 'B'])
    expect(steps.find((s) => s.tier === '目标')?.concepts).toEqual(['B'])
  })

  it('误解点且已掌握不进入澄清列表', () => {
    const steps = buildNextSteps([
      { name: 'E', mastery: 0.9, misconception: '旧误解', attemptCount: 5 }
    ])
    expect(steps.some((s) => s.tier === '目标')).toBe(false)
    expect(steps[0]?.tier).toBe('掌握')
  })

  it('没有已掌握概念时不生成「向前推进」建议', () => {
    const steps = buildNextSteps([
      { name: 'A', mastery: 0.2, misconception: null, attemptCount: 1 },
      { name: 'C', mastery: 0.5, misconception: null, attemptCount: 2 }
    ])
    expect(steps.map((s) => s.tier)).toEqual(['薄弱', '理解'])
  })
})
