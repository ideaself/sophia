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
  extractConceptUpdates,
  parseUpdates
} from '../../../src/main/learning-memory/concept-extractor'

const CONFIG = { apiKey: 'sk-test', baseUrl: 'https://api.example.com', model: 'deepseek-v4-flash' }

beforeEach(() => {
  llm.chat.mockReset()
})

describe('extractConceptUpdates', () => {
  it('parses a well-formed JSON array', async () => {
    llm.chat.mockResolvedValue({
      content: JSON.stringify([{ name: '熵', performance: 'correct' }])
    })

    await expect(extractConceptUpdates('对话', CONFIG)).resolves.toEqual([
      { name: '熵', performance: 'correct' }
    ])
  })

  it('returns null for an empty model response', async () => {
    llm.chat.mockResolvedValue({ content: '' })

    await expect(extractConceptUpdates('对话', CONFIG)).resolves.toBeNull()
  })

  it('returns null and warns when the model call fails', async () => {
    llm.chat.mockRejectedValue(new Error('llm down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(extractConceptUpdates('对话', CONFIG)).resolves.toBeNull()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('概念识别失败'),
        'llm down'
      )
    } finally {
      warn.mockRestore()
    }
  })
})

describe('parseUpdates', () => {
  it('accepts a bare array', () => {
    expect(parseUpdates('[{"name":"焓","performance":"partial"}]')).toEqual([
      { name: '焓', performance: 'partial' }
    ])
  })

  it('returns null for valid but non-array JSON', () => {
    expect(parseUpdates('{"name":"熵"}')).toBeNull()
  })

  it('extracts the array from surrounding prose', () => {
    expect(parseUpdates('分析如下：\n[{"name":"熵","performance":"unclear"}]\n以上。')).toEqual([
      { name: '熵', performance: 'unclear' }
    ])
  })

  it('returns null when no JSON array can be recovered', () => {
    expect(parseUpdates('完全没有 JSON')).toBeNull()
    expect(parseUpdates('[ 这不是 JSON ]')).toBeNull()
    expect(parseUpdates('] 反向括号 [')).toBeNull()
  })

  it('skips junk entries and keeps valid ones', () => {
    const raw = JSON.stringify([
      null,
      42,
      { name: '  ', performance: 'correct' },
      { name: '温度', performance: 'unknown' },
      { name: '内能', performance: 'incorrect', misconception: ' 混淆功与热 ' }
    ])

    expect(parseUpdates(raw)).toEqual([
      { name: '内能', performance: 'incorrect', misconception: '混淆功与热' }
    ])
  })

  it('omits an empty misconception', () => {
    expect(
      parseUpdates(JSON.stringify([{ name: '功', performance: 'correct', misconception: '   ' }]))
    ).toEqual([{ name: '功', performance: 'correct' }])
  })
})
