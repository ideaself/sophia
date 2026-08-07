import { describe, it, expect } from 'vitest'
import { parseAudioScript, parseTimeline, parseFaq } from '../../src/shared/lesson-media'

describe('parseAudioScript', () => {
  it('解析双人对白', () => {
    const lines = parseAudioScript('【导师】什么是导数？\n【学习者】就是瞬时变化率。\n【导师】很好。')
    expect(lines).toEqual([
      { speaker: '导师', text: '什么是导数？' },
      { speaker: '学习者', text: '就是瞬时变化率。' },
      { speaker: '导师', text: '很好。' }
    ])
  })

  it('跳过标题与空行', () => {
    const lines = parseAudioScript('## 回顾\n\n【导师】 A\n\n说明文字')
    expect(lines).toEqual([{ speaker: '导师', text: 'A' }])
  })

  it('无法解析返回空数组', () => {
    expect(parseAudioScript('什么都没有')).toEqual([])
  })
})

describe('parseTimeline', () => {
  it('解析时间线事件', () => {
    const events = parseTimeline('- 00:00 引入主题：从一道方程开始\n- 03:25 定义概念：给出极限的定义')
    expect(events).toEqual([
      { time: '00:00', name: '引入主题', description: '从一道方程开始' },
      { time: '03:25', name: '定义概念', description: '给出极限的定义' }
    ])
  })

  it('时间可一位数分钟', () => {
    const events = parseTimeline('- 5:30 练习：解两道题')
    expect(events[0]).toEqual({ time: '5:30', name: '练习', description: '解两道题' })
  })

  it('忽略非时间线行', () => {
    const events = parseTimeline('本节课时间线：\n- 01:00 提问：检验理解\n（后面没时间了）')
    expect(events).toHaveLength(1)
  })
})

describe('parseFaq', () => {
  it('解析成对问答', () => {
    const entries = parseFaq('- 问：为什么需要极限？\n- 答：为了描述逼近但达不到的过程。\n- 问：极限是函数值吗？\n- 答：不是，是逼近的趋势。')
    expect(entries).toEqual([
      { question: '为什么需要极限？', answer: '为了描述逼近但达不到的过程。' },
      { question: '极限是函数值吗？', answer: '不是，是逼近的趋势。' }
    ])
  })

  it('问没有答的条目被丢弃', () => {
    const entries = parseFaq('- 问：孤立的提问\n- 答：有回答的。')
    expect(entries).toEqual([{ question: '孤立的提问', answer: '有回答的。' }])
  })

  it('空内容返回空数组', () => {
    expect(parseFaq('')).toEqual([])
  })
})
