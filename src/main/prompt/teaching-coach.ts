import { DeepSeekClient } from '../llm/deepseek-client'
import { createDeepSeekHttpAdapter } from '../llm/deepseek-http-adapter'
import type { DeepSeekChatMessage } from '../llm/types'
import type { Companion } from '../../shared/schemas/companion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeachingCoachAssessment {
  companionBehavior: string
  learnerEngagement: string
  isLearnerDrivingRepetition: boolean
  isTangent: boolean
  mainlineTopic: string
  currentFocus: string
  learnerWeakPoint: string
  recentPatterns: string
  teachingGoalAlignment: string
  recommendedAction: string
  actionReason: string
  responsePlaybook: {
    ifShortAck: string
    ifQuestion: string
    ifSubstantive: string
    ifConfused: string
  }
  qualityFlags: string[]
  contentProgress: string
}

export interface AnalyzeConfig {
  apiKey: string
  baseUrl: string
  model: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Run analysis every N user messages. */
export const ANALYSIS_INTERVAL = 4

const COACH_PROMPT = `你是苏格拉底式教学教练。分析以下师生对话历史（AI学习伙伴 vs 学习者），输出教学状态评估。

评估维度：
1. companionBehavior - 伙伴行为分类（normal / looping / drifting / criticizing_author / vague_answers）
2. learnerEngagement - 学习者投入度（passive / following / curious / deeply_engaged / frustrated）
3. isLearnerDrivingRepetition - 重复是否由学习者主动驱动
4. isTangent - 是否在岔题
5. mainlineTopic - 主线话题（如有岔题）
6. currentFocus - 当前焦点
7. learnerWeakPoint - 学习者薄弱点
8. recentPatterns - 近期规律
9. teachingGoalAlignment - 目标对齐度（aligned / slightly_off / off_track）
10. recommendedAction - 建议行动（advance / deepen / honor_curiosity / challenge / rescue / address_question / return_to_mainline）
11. actionReason - 行动理由
12. responsePlaybook - 回应预案（4 个子字段）
    - ifShortAck: 学习者简短回应时的预案
    - ifQuestion: 学习者提问时的预案
    - ifSubstantive: 学习者实质性回答时的预案
    - ifConfused: 学习者表示困惑时的预案
13. qualityFlags - 质量提醒（字符串数组）
14. contentProgress - 内容推进状态（"first_half" | "second_half"）

只输出 JSON，不要附加任何说明文字。输出 JSON 格式：

{
  "companionBehavior": "normal",
  "learnerEngagement": "following",
  "isLearnerDrivingRepetition": false,
  "isTangent": false,
  "mainlineTopic": "",
  "currentFocus": "",
  "learnerWeakPoint": "",
  "recentPatterns": "",
  "teachingGoalAlignment": "aligned",
  "recommendedAction": "deepen",
  "actionReason": "",
  "responsePlaybook": {
    "ifShortAck": "",
    "ifQuestion": "",
    "ifSubstantive": "",
    "ifConfused": ""
  },
  "qualityFlags": [],
  "contentProgress": "first_half"
}`

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decide whether a teaching-coach analysis should run at the current
 * turn count.  Analysis triggers every ANALYSIS_INTERVAL user messages,
 * starting from the second interval (so the first few turns get through
 * before the coach kicks in).
 */
export function shouldAnalyze(userMessageCount: number): boolean {
  return userMessageCount >= ANALYSIS_INTERVAL && userMessageCount % ANALYSIS_INTERVAL === 0
}

/**
 * Call the LLM to analyse the ongoing teaching session and return a
 * structured assessment.
 *
 * Fault tolerance:
 *   1. JSON.parse fails  -> try regex extraction, then retry once after 500ms
 *   2. retry also fails  -> return null (non-fatal, caller skips injection)
 */
export async function analyzeTeaching(
  history: DeepSeekChatMessage[],
  companion: Companion,
  textbookTitle: string | undefined,
  config: AnalyzeConfig
): Promise<TeachingCoachAssessment | null> {
  const transcript = history
    .map((m) => `${m.role === 'user' ? '学习者' : '导师'}: ${m.content}`)
    .join('\n\n')

  const userPrompt = [
    `教材：${textbookTitle ?? '未指定'}`,
    `AI伙伴：${companion.name}（${companion.identity}）`,
    '',
    '--- 对话历史 ---',
    transcript
  ].join('\n')

  const endpoint = config.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const adapter = createDeepSeekHttpAdapter({ endpoint })
  const client = new DeepSeekClient(config.apiKey, adapter, config.model)

  // First attempt
  let raw = await callCoach(client, userPrompt)
  let parsed = parseAssessment(raw)
  if (parsed) return parsed

  console.warn('[teaching-coach] First parse failed, retrying after 500ms. Raw (first 200):', raw.slice(0, 200))

  // Retry after delay
  await new Promise((r) => setTimeout(r, 500))
  raw = await callCoach(client, userPrompt)
  parsed = parseAssessment(raw)
  if (parsed) return parsed

  console.warn('[teaching-coach] Retry also failed, skipping analysis this turn')
  return null
}

/**
 * Format an assessment into a system-prompt segment for injection.
 */
export function formatAssessment(assessment: TeachingCoachAssessment, round: number): string {
  const lines: string[] = [
    `[== 教学教练分析 · 第 ${round} 轮 ==]`,
    '',
    '◆ 当前状态',
    `伙伴行为：${translateBehavior(assessment.companionBehavior)}`,
    `学习者投入：${translateEngagement(assessment.learnerEngagement)}`,
    `当前焦点：${assessment.currentFocus || '—'}`,
    `学习者薄弱点：${assessment.learnerWeakPoint || '—'}`,
    `近期规律：${assessment.recentPatterns || '—'}`,
  ]

  // Behavior-specific guidance
  if (assessment.companionBehavior === 'looping') {
    lines.push('', '⚠️ 伙伴正在绕圈，必须推进新内容或换角度。')
  } else if (assessment.companionBehavior === 'drifting') {
    lines.push('', '⚠️ 伙伴正在飘离，拉回具体概念/数据/案例。')
  } else if (assessment.companionBehavior === 'criticizing_author') {
    lines.push('', '⚠️ 伙伴在批评教材作者，立即回到教材内容本身。')
  } else if (assessment.companionBehavior === 'vague_answers') {
    lines.push('', '⚠️ 伙伴回答模糊，要求具体化。')
  }

  lines.push(
    '',
    `◆ 目标对齐度：${translateAlignment(assessment.teachingGoalAlignment)}`,
    `◆ 本轮建议：${translateAction(assessment.recommendedAction)} - ${assessment.actionReason || ''}`,
    '',
    '◆ 回应预案（根据学习者下一条消息选择）',
    `如果简短回应：${assessment.responsePlaybook.ifShortAck || '—'}`,
    `如果学习者提问：${assessment.responsePlaybook.ifQuestion || '—'}`,
    `如果实质性回答：${assessment.responsePlaybook.ifSubstantive || '—'}`,
    `如果表示困惑：${assessment.responsePlaybook.ifConfused || '—'}`,
  )

  if (assessment.qualityFlags.length > 0) {
    lines.push('', `⚠️ 质量提醒：${assessment.qualityFlags.join('；')}`)
  }

  lines.push(
    '',
    '◆ 回复要求（仅供内部遵守，不得输出到回复中）',
    '正文（不含最后的问题）≤ 120 字；以问题结尾，问题单独成行；绝对禁止在回复末尾附加任何核查注释或勾选列表。'
  )

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function callCoach(client: DeepSeekClient, userPrompt: string): Promise<string> {
  const response = await client.chat([
    { role: 'system', content: COACH_PROMPT },
    { role: 'user', content: userPrompt }
  ])
  return response.content?.trim() ?? ''
}

function parseAssessment(raw: string): TeachingCoachAssessment | null {
  // Try direct JSON.parse first
  try {
    const obj = JSON.parse(raw)
    return normalizeAssessment(obj)
  } catch {
    // fall through to regex extraction
  }

  // Regex fallback: extract the JSON object from surrounding text
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0])
      return normalizeAssessment(obj)
    } catch {
      // fall through
    }
  }

  return null
}

function normalizeAssessment(obj: unknown): TeachingCoachAssessment | null {
  if (typeof obj !== 'object' || obj === null) return null
  const o = obj as Record<string, unknown>
  const playbook = (o.responsePlaybook ?? {}) as Record<string, unknown>

  return {
    companionBehavior: String(o.companionBehavior ?? 'normal'),
    learnerEngagement: String(o.learnerEngagement ?? 'following'),
    isLearnerDrivingRepetition: Boolean(o.isLearnerDrivingRepetition),
    isTangent: Boolean(o.isTangent),
    mainlineTopic: String(o.mainlineTopic ?? ''),
    currentFocus: String(o.currentFocus ?? ''),
    learnerWeakPoint: String(o.learnerWeakPoint ?? ''),
    recentPatterns: String(o.recentPatterns ?? ''),
    teachingGoalAlignment: String(o.teachingGoalAlignment ?? 'aligned'),
    recommendedAction: String(o.recommendedAction ?? 'advance'),
    actionReason: String(o.actionReason ?? ''),
    responsePlaybook: {
      ifShortAck: String(playbook.ifShortAck ?? ''),
      ifQuestion: String(playbook.ifQuestion ?? ''),
      ifSubstantive: String(playbook.ifSubstantive ?? ''),
      ifConfused: String(playbook.ifConfused ?? ''),
    },
    qualityFlags: Array.isArray(o.qualityFlags) ? o.qualityFlags.map(String) : [],
    contentProgress: String(o.contentProgress ?? 'first_half'),
  }
}

function translateBehavior(v: string): string {
  const map: Record<string, string> = {
    normal: '正常',
    looping: '绕圈',
    drifting: '飘离',
    criticizing_author: '批评作者',
    vague_answers: '回答模糊',
  }
  return map[v] ?? v
}

function translateEngagement(v: string): string {
  const map: Record<string, string> = {
    passive: '被动',
    following: '跟随',
    curious: '好奇',
    deeply_engaged: '深度投入',
    frustrated: '困惑/受挫',
  }
  return map[v] ?? v
}

function translateAlignment(v: string): string {
  const map: Record<string, string> = {
    aligned: '✓ 对齐',
    slightly_off: '略偏',
    off_track: '❌ 偏离',
  }
  return map[v] ?? v
}

function translateAction(v: string): string {
  const map: Record<string, string> = {
    advance: '推进新内容',
    deepen: '加深当前话题',
    honor_curiosity: '满足好奇心',
    challenge: '用情境挑战',
    rescue: '救场',
    address_question: '先答问题',
    return_to_mainline: '回到主线',
  }
  return map[v] ?? v
}
