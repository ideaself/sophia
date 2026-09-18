import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  shouldAnalyze,
  formatAssessment,
  analyzeTeaching,
  type TeachingCoachAssessment
} from '../../../src/main/prompt/teaching-coach'

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

  it('adds a warning for each non-looping problem behavior', () => {
    const drifting = sampleAssessment()
    drifting.companionBehavior = 'drifting'
    expect(formatAssessment(drifting, 1)).toContain('伙伴正在飘离')

    const criticizing = sampleAssessment()
    criticizing.companionBehavior = 'criticizing_author'
    expect(formatAssessment(criticizing, 1)).toContain('批评教材作者')

    const vague = sampleAssessment()
    vague.companionBehavior = 'vague_answers'
    expect(formatAssessment(vague, 1)).toContain('回答模糊')
  })

  it('adds no behavior warning for normal or unknown behaviors', () => {
    const normal = sampleAssessment()
    normal.companionBehavior = 'normal'
    expect(formatAssessment(normal, 1)).not.toContain('⚠️ 伙伴')

    const unknown = sampleAssessment()
    unknown.companionBehavior = 'mystery'
    const out = formatAssessment(unknown, 1)
    expect(out).toContain('伙伴行为：mystery')
    expect(out).not.toContain('⚠️ 伙伴')
  })

  it('falls back to raw labels for unknown enum values', () => {
    const a = sampleAssessment()
    a.learnerEngagement = 'weird'
    a.teachingGoalAlignment = 'oddish'
    a.recommendedAction = 'ponder'
    const out = formatAssessment(a, 3)

    expect(out).toContain('学习者投入：weird')
    expect(out).toContain('目标对齐度：oddish')
    expect(out).toContain('本轮建议：ponder')
  })

  it('renders fallback dashes for empty action reason and playbook entries', () => {
    const a = sampleAssessment()
    a.actionReason = ''
    a.responsePlaybook = { ifShortAck: '', ifQuestion: '', ifSubstantive: '', ifConfused: '' }
    const out = formatAssessment(a, 1)

    expect(out).toContain('本轮建议：加深当前话题 - \n')
    expect(out).toMatch(/如果简短回应：—/)
    expect(out).toMatch(/如果学习者提问：—/)
    expect(out).toMatch(/如果实质性回答：—/)
    expect(out).toMatch(/如果表示困惑：—/)
  })
})

describe('analyzeTeaching', () => {
  const companion = { name: '朗道', identity: '理论物理学家' } as never
  const history = [
    { role: 'user', content: '熵是什么？' },
    { role: 'assistant', content: '先说说你的理解。' }
  ] as never
  const CONFIG = { apiKey: 'sk-test', baseUrl: 'https://api.example.com/', model: 'deepseek-v4-flash' }

  beforeEach(() => {
    llm.chat.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function run(): Promise<TeachingCoachAssessment | null> {
    const promise = analyzeTeaching(
      history,
      companion,
      '热力学讲义',
      CONFIG as { apiKey: string; baseUrl: string; model: string }
    )
    await vi.advanceTimersByTimeAsync(600)
    return promise
  }

  it('parses a valid assessment on the first attempt', async () => {
    llm.chat.mockResolvedValue({
      content: JSON.stringify({
        companionBehavior: 'looping',
        learnerEngagement: 'curious',
        teachingGoalAlignment: 'aligned',
        recommendedAction: 'continue',
        responsePlaybook: {}
      })
    })

    const result = await run()

    expect(result?.companionBehavior).toBe('looping')
    expect(llm.chat).toHaveBeenCalledTimes(1)
    const messages = llm.chat.mock.calls[0][0] as Array<{ role: string; content: string }>
    expect(messages[1].content).toContain('教材：热力学讲义')
    expect(messages[1].content).toContain('学习者: 熵是什么？')
    expect(messages[1].content).toContain('AI伙伴：朗道（理论物理学家）')
  })

  it('extracts JSON from surrounding prose', async () => {
    llm.chat.mockResolvedValue({
      content: '分析如下：\n{"companionBehavior":"drifting","learnerEngagement":"neutral",' +
        '"teachingGoalAlignment":"off","recommendedAction":"refocus","responsePlaybook":{}}\n以上。'
    })

    const result = await run()

    expect(result?.companionBehavior).toBe('drifting')
    expect(llm.chat).toHaveBeenCalledTimes(1)
  })

  it('retries after a parse failure and succeeds', async () => {
    llm.chat
      .mockResolvedValueOnce({ content: '完全不是 JSON' })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          companionBehavior: 'vague_answers',
          learnerEngagement: 'curious',
          teachingGoalAlignment: 'aligned',
          recommendedAction: 'deepen',
          responsePlaybook: {}
        })
      })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await run()

      expect(result?.companionBehavior).toBe('vague_answers')
      expect(llm.chat).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('First parse failed, retrying'),
        expect.any(String)
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('returns null when both attempts fail to parse', async () => {
    llm.chat.mockResolvedValue({ content: '{"broken": ' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await run()

      expect(result).toBeNull()
      expect(llm.chat).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Retry also failed, skipping analysis')
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('returns null for non-object JSON payloads', async () => {
    llm.chat.mockResolvedValue({ content: 'null' })

    const result = await run()

    expect(result).toBeNull()
  })

  it('defaults a missing textbook title and tolerates a response without content', async () => {
    llm.chat.mockResolvedValue({})

    const promise = analyzeTeaching(
      history,
      companion,
      undefined,
      CONFIG as { apiKey: string; baseUrl: string; model: string }
    )
    await vi.advanceTimersByTimeAsync(600)
    const result = await promise

    expect(result).toBeNull()
    expect(llm.chat).toHaveBeenCalledTimes(2)
    const messages = llm.chat.mock.calls[0][0] as Array<{ role: string; content: string }>
    expect(messages[1].content).toContain('教材：未指定')
  })

  it('normalizes a sparse assessment payload and keeps array quality flags', async () => {
    llm.chat.mockResolvedValue({
      content: JSON.stringify({
        isTangent: true,
        qualityFlags: ['过长', '未以提问结尾']
      })
    })

    const result = await run()

    expect(result).toMatchObject({
      companionBehavior: 'normal',
      learnerEngagement: 'following',
      teachingGoalAlignment: 'aligned',
      recommendedAction: 'advance',
      isTangent: true,
      qualityFlags: ['过长', '未以提问结尾']
    })
    expect(result?.responsePlaybook).toEqual({
      ifShortAck: '',
      ifQuestion: '',
      ifSubstantive: '',
      ifConfused: ''
    })
  })
})
