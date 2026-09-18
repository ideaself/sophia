import { describe, it, expect } from 'vitest'
import { parseEventCard } from '../../src/shared/event-cards'
import { isKnowledgeQuestion, hasTextbookCitation } from '../../src/shared/grounding'

describe('parseEventCard', () => {
  it('解析提示卡（💡）', () => {
    const card = parseEventCard('> 💡 提示：想想勾股定理。\n下一步试试。')
    expect(card).toEqual({ kind: 'hint', body: '想想勾股定理。', rest: '下一步试试。' })
  })

  it('解析多行提示卡（连续引用块并入 body）', () => {
    const card = parseEventCard('> 💡 提示：先拆成两步。\n> 第一步是求导。')
    expect(card?.kind).toBe('hint')
    expect(card?.body).toBe('先拆成两步。\n第一步是求导。')
    expect(card?.rest).toBe('')
  })

  it('解析纠错卡（⚠️）与记忆提议卡（🧠）', () => {
    expect(parseEventCard('> ⚠️ 纠正：不是逐点相乘。')?.kind).toBe('correction')
    expect(parseEventCard('> 🧠 建议记忆：导数的定义是什么？ - 瞬时变化率')?.kind).toBe('memory')
  })

  it('空行前缀不影响解析', () => {
    const card = parseEventCard('\n\n> 💡 提示：从定义出发。')
    expect(card?.body).toBe('从定义出发。')
  })

  it('非事件卡片内容返回 null', () => {
    expect(parseEventCard('普通回复内容')).toBeNull()
    expect(parseEventCard('> 这是普通引用。')).toBeNull()
    expect(parseEventCard('')).toBeNull()
  })

  it('rest 去除首尾空行', () => {
    const card = parseEventCard('> 💡 提示：提示内容。\n\n正文继续。\n')
    expect(card?.rest).toBe('正文继续。')
  })

  it('正文为空的卡片返回 null，连续引用块中的空行被跳过', () => {
    expect(parseEventCard('> 💡 提示：')).toBeNull()
    expect(parseEventCard('> 💡 提示：\n>   \n> 补充线索。')).toEqual({
      kind: 'hint',
      body: '补充线索。',
      rest: ''
    })
  })
})

describe('grounding 规则校验', () => {
  it('识别知识性提问', () => {
    expect(isKnowledgeQuestion('什么是导数？')).toBe(true)
    expect(isKnowledgeQuestion('为什么需要极限？')).toBe(true)
    expect(isKnowledgeQuestion('请解释一下傅里叶变换')).toBe(true)
    expect(isKnowledgeQuestion('你能再讲讲吗？')).toBe(true)
    expect(isKnowledgeQuestion('好的，我明白了。')).toBe(false)
    expect(isKnowledgeQuestion('')).toBe(false)
  })

  it('识别教材出处引用', () => {
    expect(hasTextbookCitation('> 【教材出处 · 《高等数学》 · 第3章】')).toBe(true)
    expect(hasTextbookCitation('这里引用自教材【教材出处 · 《线性代数》 · 2.1】')).toBe(true)
    expect(hasTextbookCitation('没有引用的普通回答')).toBe(false)
  })
})
