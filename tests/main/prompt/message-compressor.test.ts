import { describe, it, expect, vi, beforeEach } from 'vitest'

const llm = vi.hoisted(() => ({ chat: vi.fn() }))

vi.mock('../../../src/main/llm/deepseek-client', () => ({
  DeepSeekClient: class {
    constructor() {}
    chat = (messages: unknown): Promise<{ content: string }> =>
      llm.chat(messages) as Promise<{ content: string }>
  }
}))

vi.mock('../../../src/main/llm/deepseek-http-adapter', () => ({
  createDeepSeekHttpAdapter: vi.fn(() => ({}))
}))

import {
  splitCompressionWindowByTokens,
  shouldCompress,
  splitCompressionWindow,
  compressMessages
} from '../../../src/main/prompt/message-compressor'
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

  it('splits exactly when the budget is filled', () => {
    // Two messages of ~250 tokens each; a 250-token budget keeps only the last.
    const msgs = [
      makeMsg('user', 'a'.repeat(1000)),
      makeMsg('assistant', 'b'.repeat(1000))
    ]
    const { toCompress, toKeep } = splitCompressionWindowByTokens(msgs, 250)
    expect(toKeep).toHaveLength(1)
    expect(toCompress.some((m) => m.content.startsWith('a'))).toBe(true)
  })
})

describe('shouldCompress', () => {
  it('triggers at 150 non-system messages', () => {
    const msgs = Array.from({ length: 149 }, () => makeMsg('user', 'x'))
    expect(shouldCompress(msgs)).toBe(false)

    msgs.push(makeMsg('assistant', 'x'))
    expect(shouldCompress(msgs)).toBe(true)
  })

  it('ignores system messages when counting', () => {
    const msgs = [
      ...Array.from({ length: 150 }, () => makeMsg('system', 's')),
      makeMsg('user', 'u')
    ]
    expect(shouldCompress(msgs)).toBe(false)
  })
})

describe('splitCompressionWindow', () => {
  it('compresses the older half and keeps the rest', () => {
    const msgs = [
      makeMsg('system', 's'),
      ...Array.from({ length: 10 }, (_, i) => makeMsg('user', `u${i}`))
    ]

    const { toCompress, toKeep } = splitCompressionWindow(msgs)

    // System message rides with the compress side; 10 non-system → 5/5 split.
    expect(toCompress[0].role).toBe('system')
    expect(toCompress).toHaveLength(6)
    expect(toKeep).toHaveLength(5)
    expect(toCompress.some((m) => m.content === 'u0')).toBe(true)
    expect(toKeep.some((m) => m.content === 'u9')).toBe(true)
  })

  it('caps the compress window at 80 messages', () => {
    const msgs = Array.from({ length: 200 }, (_, i) => makeMsg('user', `u${i}`))

    const { toCompress, toKeep } = splitCompressionWindow(msgs)

    expect(toCompress).toHaveLength(80)
    expect(toKeep).toHaveLength(120)
  })
})

describe('compressMessages', () => {
  beforeEach(() => {
    llm.chat.mockReset()
  })

  it('summarizes the transcript through the configured model', async () => {
    llm.chat.mockResolvedValue({ content: '  摘要内容  ' })

    const summary = await compressMessages(
      [makeMsg('user', '熵是什么？'), makeMsg('assistant', '状态函数。')],
      { apiKey: 'sk-test', baseUrl: 'https://api.example.com/', model: 'deepseek-v4-flash' }
    )

    expect(summary).toBe('摘要内容')
    const messages = llm.chat.mock.calls[0][0] as Array<{ role: string; content: string }>
    expect(messages[1].content).toContain('学习者: 熵是什么？')
    expect(messages[1].content).toContain('导师: 状态函数。')
  })

  it('returns an empty summary when the model answers with nothing', async () => {
    llm.chat.mockResolvedValue({ content: '' })

    await expect(
      compressMessages([makeMsg('user', 'x')], {
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com',
        model: 'm'
      })
    ).resolves.toBe('')
  })
})
