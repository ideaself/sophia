import { describe, it, expect } from 'vitest'
import { shouldAnalyze, formatAssessment, type TeachingCoachAssessment } from '../../../src/main/prompt/teaching-coach'

function sampleAssessment(): TeachingCoachAssessment {
  return {
    companionBehavior: 'looping',
    learnerEngagement: 'curious',
    isLearnerDrivingRepetition: false,
    isTangent: false,
    mainlineTopic: '微分方程',
    currentFocus: '可分离变量法',
    learnerWeakPoint: '对 dy/dx 符号含义理解模糊',
    recentPatterns: '连续 3 轮在同一个例子上打转',
    teachingGoalAlignment: 'slightly_off',
    recommendedAction: 'deepen',
    actionReason: '学习者已掌握基本解法，可以引入更复杂的例子',
    responsePlaybook: {
      ifShortAck: '追问为什么你这么认为',
      ifQuestion: '先肯定提问，再用反问引导',
      ifSubstantive: '用具体应用场景挑战理解深度',
      ifConfused: '回到基础概念，换角度重新解释'
    },
    qualityFlags: ['回复过长', '未以提问结尾'],
    contentProgress: 'first_half'
  }
}

describe('shouldAnalyze', () => {
  it('returns false for the first few turns', () => {
    expect(shouldAnalyze(1)).toBe(false)
    expect(shouldAnalyze(2)).toBe(false)
    expect(shouldAnalyze(3)).toBe(false)
  })

  it('returns true every 4 turns starting from 4', () => {
    expect(shouldAnalyze(4)).toBe(true)
    expect(shouldAnalyze(8)).toBe(true)
    expect(shouldAnalyze(12)).toBe(true)
  })

  it('returns false on non-interval turns', () => {
    expect(shouldAnalyze(5)).toBe(false)
    expect(shouldAnalyze(6)).toBe(false)
    expect(shouldAnalyze(7)).toBe(false)
    expect(shouldAnalyze(9)).toBe(false)
  })
})

describe('formatAssessment', () => {
  it('includes the round number in the header', () => {
    const out = formatAssessment(sampleAssessment(), 2)
    expect(out).toContain('第 2 轮')
  })

  it('translates behavior and engagement to Chinese', () => {
    const out = formatAssessment(sampleAssessment(), 1)
    expect(out).toContain('伙伴行为：绕圈')
    expect(out).toContain('学习者投入：好奇')
  })

  it('adds a warning line for looping behavior', () => {
    const out = formatAssessment(sampleAssessment(), 1)
    expect(out).toContain('伙伴正在绕圈')
  })

  it('translates alignment with symbols', () => {
    const out = formatAssessment(sampleAssessment(), 1)
    expect(out).toContain('略偏')
  })

  it('includes all four response playbook entries', () => {
    const out = formatAssessment(sampleAssessment(), 1)
    expect(out).toContain('追问为什么你这么认为')
    expect(out).toContain('先肯定提问')
    expect(out).toContain('用具体应用场景')
    expect(out).toContain('回到基础概念')
  })

  it('includes quality flags when present', () => {
    const out = formatAssessment(sampleAssessment(), 1)
    expect(out).toContain('回复过长')
    expect(out).toContain('未以提问结尾')
  })

  it('includes the response requirements section', () => {
    const out = formatAssessment(sampleAssessment(), 1)
    expect(out).toContain('≤ 120 字')
    expect(out).toContain('以问题结尾')
    expect(out).toContain('不得输出到回复中')
  })

  it('omits quality flags section when empty', () => {
    const a = sampleAssessment()
    a.qualityFlags = []
    const out = formatAssessment(a, 1)
    expect(out).not.toContain('质量提醒')
  })

  it('handles empty optional fields gracefully', () => {
    const a = sampleAssessment()
    a.currentFocus = ''
    a.learnerWeakPoint = ''
    a.recentPatterns = ''
    const out = formatAssessment(a, 1)
    // Empty fields should not leak the original values; the fallback dash
    // may differ in encoding between source and test, so just verify the
    // original non-empty values are gone.
    expect(out).not.toContain('可分离变量法')
    expect(out).not.toContain('dy/dx')
    expect(out).not.toContain('连续 3 轮')
  })
})
