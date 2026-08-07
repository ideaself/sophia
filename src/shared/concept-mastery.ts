/**
 * 概念掌握度 prompt 注入段（里程碑 3）：
 * 把已积累的概念状态与教学策略写进课堂 system prompt，
 * 让导师"知道学习者会什么、不会什么"——薄弱优先复习、已掌握不重复讲。
 */

export interface ConceptStateBrief {
  name: string
  mastery: number
  misconception: string | null
}

export function masteryTier(m: number): '掌握' | '理解' | '薄弱' {
  if (m >= 0.7) return '掌握'
  if (m >= 0.35) return '理解'
  return '薄弱'
}

const TIER_COLORS: Record<ReturnType<typeof masteryTier>, string> = {
  掌握: '已掌握',
  理解: '基本理解',
  薄弱: '薄弱'
}

/** 生成「## 学习者的概念掌握度」提示段；无可注入内容时返回 null。 */
export function buildConceptMasterySegment(concepts: ConceptStateBrief[]): string | null {
  const meaningful = concepts
    .filter((c) => c.name.trim())
    .sort((a, b) => a.mastery - b.mastery)
  if (meaningful.length === 0) return null

  const lines = meaningful.map((c) => {
    const tier = TIER_COLORS[masteryTier(c.mastery)]
    const mis = c.misconception ? `，误解点：${c.misconception}` : ''
    return `- ${c.name}：${tier}（掌握度 ${Math.round(c.mastery * 100)}%）${mis}`
  })

  return [
    '## 学习者的概念掌握度',
    '',
    '以下是对学习者长期掌握度的结构化记录（来自此前课堂问答的累计判断），按薄弱到掌握排列：',
    '',
    ...lines,
    '',
    '教学策略：',
    '- 「薄弱」概念：优先复习巩固，重新讲解并引导练习，直到转为「基本理解」以上。',
    '- 「基本理解」概念：通过提问或小练习加深，可进入进阶内容。',
    '- 「已掌握」概念：不要重复讲授，直接推进新内容。',
    '- 若某概念标注了误解点，必须先针对误解澄清，再继续。',
    '- 这些记录是推断而非定论：若学习者在当前课堂表现出相反状态，以当前课堂的实际表现为准。'
  ].join('\n')
}
