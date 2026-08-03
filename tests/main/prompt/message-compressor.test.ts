import { describe, it, expect } from 'vitest'
import { splitCompressionWindowByTokens } from '../../../src/main/prompt/message-compressor'
import type { DeepSeekChatMessage } from '../../../src/main/llm/types'

const makeMsg = (role: 'system' | 'user' | 'assistant', content: string): DeepSeekChatMessage => ({
  role,
  content
})

describe('splitCompressionWindowByTokens', () => {
  it('keeps only the newest messages within the token budget', () => {
    // 8 messages × 1000 ASCII chars ≈ 250 tokens each = 2000 tokens total.
    const msgs = Array.from({ length: 8 }, (_, i) =>
      makeMsg(i % 2 === 0 ? 'user' : 'assistant', `msg${i}-` + 'x'.repeat(1000))
    )

    const { toCompress, toKeep } = splitCompressionWindowByTokens(msgs, 500)

    // ~500 token budget → roughly the last 2 messages stay.
    expect(toKeep.length).toBeGreaterThanOrEqual(1)
    expect(toCompress.length).toBeGreaterThanOrEqual(1)
    expect(toKeep.some((m) => m.content.startsWith('msg7-'))).toBe(true)
    expect(toCompress.some((m) => m.content.startsWith('msg0-'))).toBe(true)
    // No overlap, no gap.
    expect(toCompress.length + toKeep.length).toBe(8)
  })

  it('carries system messages into the compress side', () => {
    const msgs = [
      makeMsg('system', '【早期对话摘要】旧摘要'),
      makeMsg('user', 'a'.repeat(2000)),
      makeMsg('assistant', 'b'.repeat(2000))
    ]
    const { toCompress } = splitCompressionWindowByTokens(msgs, 100)
    expect(toCompress[0].role).toBe('system')
  })

  it('keeps at least one message on each side', () => {
    const msgs = [makeMsg('user', 'x'), makeMsg('assistant', 'y')]
    const { toCompress, toKeep } = splitCompressionWindowByTokens(msgs, 1000)
    expect(toCompress.length).toBe(1)
    expect(toKeep.length).toBe(1)
  })

  it('empty input yields empty sides', () => {
    const { toCompress, toKeep } = splitCompressionWindowByTokens([], 500)
    expect(toCompress).toEqual([])
    expect(toKeep).toEqual([])
  })
})
