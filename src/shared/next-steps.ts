/**
 * 复盘页「下一步建议」（里程碑 3）：
 * 根据概念掌握度 + 学习目标生成下一步行动建议。纯规则、零 LLM 成本。
 */

export interface ConceptSummary {
  name: string
  mastery: number
  misconception: string | null
  attemptCount: number
}

export interface NextStep {
  tier: '薄弱' | '理解' | '掌握' | '目标'
  title: string
  concepts: string[]
  action: string
}

const TIER_OF: Record<string, '薄弱' | '理解' | '掌握'> = {
  weak: '薄弱',
  mid: '理解',
  strong: '掌握'
}

/** 根据概念掌握度生成下一步建议；无概念数据时返回空数组。 */
export function buildNextSteps(concepts: ConceptSummary[]): NextStep[] {
  if (concepts.length === 0) return []

  const weak = concepts.filter((c) => c.mastery < 0.35)
  const mid = concepts.filter((c) => c.mastery >= 0.35 && c.mastery < 0.7)
  const strong = concepts.filter((c) => c.mastery >= 0.7)
  const withMisconception = concepts.filter((c) => c.misconception && c.mastery < 0.7)

  const steps: NextStep[] = []

  if (withMisconception.length > 0) {
    steps.push({
      tier: '目标',
      title: '先澄清误解',
      concepts: withMisconception.map((c) => c.name),
      action: '下节课优先针对误解点（答错的思路）澄清，再重新建立正确理解。'
    })
  }

  if (weak.length > 0) {
    steps.push({
      tier: '薄弱',
      title: '薄弱概念需要复习',
      concepts: weak.map((c) => c.name),
      action: '在课堂开场复习这些概念（导师先提问唤起记忆，再小练几题），直到转为「理解」以上。'
    })
  }

  if (mid.length > 0) {
    steps.push({
      tier: '理解',
      title: '巩固提升',
      concepts: mid.map((c) => c.name),
      action: '通过进阶例题和变式练习加深理解，目标转为「掌握」。'
    })
  }

  if (strong.length > 0) {
    steps.push({
      tier: '掌握',
      title: '可以向前推进',
      concepts: strong.map((c) => c.name),
      action: '这些概念已掌握，无需重复讲解；把课堂时间用于新内容。'
    })
  }

  return steps
}

export { TIER_OF }
