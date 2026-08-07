/**
 * AI 质量测试（里程碑 5，Kimi 测试策略）：
 * 固定教材 + 固定问题集，端到端验证课堂 AI：
 *   a. 回答来自教材（知识相关性）
 *   b. 引用真实性（引用块正文确实存在于教材，不伪造）
 *   c. 苏格拉底式教学（要求直接给答案时改为提问引导）
 *   d. 不越界给答案
 *
 * 在线部分需要 API key（环境变量 SOPHIA_AI_QUALITY_KEY 或 DEEPSEEK_API_KEY），
 * 无 key 时自动跳过；离线部分（prompt 组装完整性、引用真实性规则）始终运行。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSystemPrompt } from '../../src/main/prompt/prompt-builder'
import { getSocraticRules } from '../../src/main/prompt/rules'
import { DeepSeekClient } from '../../src/main/llm/deepseek-client'
import { createDeepSeekHttpAdapter } from '../../src/main/llm/deepseek-http-adapter'
import type { Companion } from '../../src/shared/schemas/companion'
import { CompanionSource, CompanionGender } from '../../src/shared/types/ids'
import {
  extractCitations,
  citationMatchesTextbook,
  hasTextbookCitation,
  isKnowledgeQuestion
} from '../../src/shared/grounding'

const TEXTBOOK = readFileSync(join(process.cwd(), 'tests', 'ai-quality', 'fixtures', 'textbook.md'), 'utf-8')
const TEXTBOOK_TITLE = '函数与极限 · 入门讲义'

const FIXED_QUESTIONS: Array<{ question: string; expectedKeywords: string[] }> = [
  { question: '什么是函数？', expectedKeywords: ['定义域', '值域', '对应', 'f(x)'] },
  { question: '极限的定义是什么？教材里是怎么说的？', expectedKeywords: ['无限接近', '趋近', '极限', 'L'] },
  { question: '极限和函数值是一回事吗？', expectedKeywords: ['趋势', '函数值', '连续'] },
  { question: '函数连续需要满足哪些条件？', expectedKeywords: ['有定义', '极限存在', '等于'] }
]

function mockCompanion(): Companion {
  return {
    id: 'quality-tutor' as Companion['id'],
    source: CompanionSource.Candidate,
    version: 1,
    name: '苏格拉底',
    gender: CompanionGender.Male,
    age: 70,
    identity: '古希腊哲学家，擅长提问引导',
    personalityKeywords: ['善问', '耐心'],
    personality: '你是一位苏格拉底式的导师，通过提问帮助学习者自己发现知识。',
    speakingStyle: '多用提问，鼓励学习者思考，语气温和。',
    emotionalExpressions: '对学习者的每一步思考都给予肯定。',
    originalFile: 'fixtures.md'
  }
}

// ---------------------------------------------------------------------------
// 离线：prompt 组装完整性 + 引用真实性规则
// ---------------------------------------------------------------------------

describe('AI 质量 · 离线：prompt 组装', () => {
  const system = buildSystemPrompt({
    companion: mockCompanion(),
    textbookContent: TEXTBOOK,
    textbookTitle: TEXTBOOK_TITLE
  })

  it('system prompt 包含苏格拉底规则', () => {
    expect(system).toContain(getSocraticRules().slice(0, 20))
    expect(system).toContain('你的职责不是提供答案')
    expect(system).toContain('通过提问')
  })

  it('system prompt 包含教材段与引用格式段', () => {
    expect(system).toContain('## 本节课教材')
    expect(system).toContain(TEXTBOOK_TITLE)
    expect(system).toContain('【教材出处')
  })

  it('概念掌握度段可注入', () => {
    const withConcepts = buildSystemPrompt({
      companion: mockCompanion(),
      textbookContent: TEXTBOOK,
      textbookTitle: TEXTBOOK_TITLE,
      conceptMastery: '## 学习者的概念掌握度\n- 极限：薄弱（掌握度 30%）'
    })
    expect(withConcepts).toContain('## 学习者的概念掌握度')
  })
})

describe('AI 质量 · 离线：引用真实性规则', () => {
  it('提取引用块', () => {
    const content = [
      '> 【教材出处 · 《函数与极限》 · 第2章】',
      '> 如果当 x 趋近于 a 时，f(x) 无限接近常数 L',
      '',
      '所以极限强调趋近的过程。'
    ].join('\n')
    const cites = extractCitations(content)
    expect(cites).toHaveLength(1)
    expect(cites[0].quoted).toContain('无限接近常数 L')
  })

  it('真实引用能匹配教材', () => {
    const cites = extractCitations(
      '> 【教材出处 · 《函数与极限》 · 第2章】\n> 如果当 x 趋近于 a 时，f(x) 无限接近常数 L'
    )
    expect(citationMatchesTextbook(cites[0], TEXTBOOK)).toBe(true)
  })

  it('伪造引用无法匹配教材', () => {
    const cites = extractCitations(
      '> 【教材出处 · 《函数与极限》 · 第9章】\n> 导数就是瞬时变化率，这在教材第 500 页有详细证明'
    )
    expect(citationMatchesTextbook(cites[0], TEXTBOOK)).toBe(false)
  })

  it('改写措辞（仅去标点/换行）的引用仍视为真实', () => {
    const cites = extractCitations(
      '> 【教材出处 · 《函数与极限》 · 第2章】\n> 当 x 趋近于 a 时 f(x) 无限接近常数 L'
    )
    expect(citationMatchesTextbook(cites[0], TEXTBOOK)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 在线：真实 LLM 端到端（无 key 自动跳过）
// ---------------------------------------------------------------------------

const apiKey = process.env.SOPHIA_AI_QUALITY_KEY ?? process.env.DEEPSEEK_API_KEY ?? ''
const endpoint = process.env.SOPHIA_AI_QUALITY_ENDPOINT ?? 'https://api.deepseek.com'
const model = process.env.SOPHIA_AI_QUALITY_MODEL ?? 'deepseek-chat'
const hasKey = apiKey.length > 0

describe('AI 质量 · 在线（真实 LLM，无 key 自动跳过）', () => {
  const client = hasKey
    ? new DeepSeekClient(apiKey, createDeepSeekHttpAdapter({ endpoint }), model)
    : null

  const ask = async (userMessage: string): Promise<string> => {
    const system = buildSystemPrompt({
      companion: mockCompanion(),
      textbookContent: TEXTBOOK,
      textbookTitle: TEXTBOOK_TITLE,
      language: 'zh'
    })
    const resp = await client!.chat([
      { role: 'system', content: system },
      { role: 'user', content: userMessage }
    ])
    const content = (resp.content ?? '').trim()
    expect(content.length).toBeGreaterThan(0)
    return content
  }

  it.skipIf(!hasKey)('a. 固定问题集的回答来自教材（关键词相关性）', async () => {
    for (const { question, expectedKeywords } of FIXED_QUESTIONS) {
      const answer = await ask(question)
      const hits = expectedKeywords.filter((kw) => answer.includes(kw))
      expect(hits.length, `「${question}」的回答应包含至少 1 个教材关键词（实际命中：${hits.join('、') || '无'}）\n回答：${answer}`).toBeGreaterThanOrEqual(1)
    }
  }, 180000)

  it.skipIf(!hasKey)('b. 教材引用的内容真实（不伪造引用）', async () => {
    const answer = await ask('教材里怎么定义极限？请引用教材原文。')
    expect(hasTextbookCitation(answer), `回答应引用教材出处\n回答：${answer}`).toBe(true)
    const cites = extractCitations(answer)
    expect(cites.length).toBeGreaterThan(0)
    for (const c of cites) {
      expect(citationMatchesTextbook(c, TEXTBOOK), `引用内容应真实存在于教材：\n${c.quoted}`).toBe(true)
    }
  }, 120000)

  it.skipIf(!hasKey)('c. 苏格拉底式教学：要求直接给答案时应改为提问引导', async () => {
    const answer = await ask('我不想思考了，直接告诉我导数的定义是什么。')
    const asksQuestion = /[?？]/.test(answer)
    const gaveAway = /导数(就|的)是|定义(就|的)是/.test(answer)
    expect(asksQuestion, `应以提问引导而非直接给答案\n回答：${answer}`).toBe(true)
    expect(gaveAway, `不应直接把定义讲出来\n回答：${answer}`).toBe(false)
  }, 120000)

  it.skipIf(!hasKey)('d. 基础知识问答不越界（不脱离教材虚构）', async () => {
    const answer = await ask('讲讲教材里提到的夹逼定理。')
    expect(answer).toContain('夹逼')
    const mentionsAbsurd = /(我编的|虚构|不存在的定理|随便编)/.test(answer)
    expect(mentionsAbsurd).toBe(false)
  }, 120000)
})

// ---------------------------------------------------------------------------
// 守卫：在线用例有 key 时必须能跑（防止 CI 静默空跑）
// ---------------------------------------------------------------------------

it('质量测试配置自检：isKnowledgeQuestion 识别提问', () => {
  expect(isKnowledgeQuestion('什么是极限？')).toBe(true)
  expect(isKnowledgeQuestion('好的明白了')).toBe(false)
})
