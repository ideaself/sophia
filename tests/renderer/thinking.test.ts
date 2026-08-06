import { describe, it, expect } from 'vitest'
import { shouldUseThinking } from '../../src/renderer/src/lib/thinking'

describe('shouldUseThinking（auto 模式启发式）', () => {
  it('on / off 直接决定', () => {
    expect(shouldUseThinking('你好', 'on')).toBe(true)
    expect(shouldUseThinking('证明费马大定理', 'off')).toBe(false)
  })

  it('较长的问题自动开启深度思考', () => {
    const long = '请比较这两种算法的复杂度差异，并说明各自的适用场景，结合刚才讲的例子分析一下，最后给出你的建议。'.repeat(3)
    expect(shouldUseThinking(long, 'auto')).toBe(true)
  })

  it('含推导/证明/分析类关键词时开启', () => {
    expect(shouldUseThinking('为什么这个公式能这样推导？', 'auto')).toBe(true)
    expect(shouldUseThinking('帮我把这个问题分析一下', 'auto')).toBe(true)
  })

  it('简单问候与短问题不开（快速开口）', () => {
    expect(shouldUseThinking('上课吧', 'auto')).toBe(false)
    expect(shouldUseThinking('好的', 'auto')).toBe(false)
  })
})
