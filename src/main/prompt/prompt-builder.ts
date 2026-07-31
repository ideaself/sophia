/**
 * Prompt builder — assembles the system prompt and chat messages
 * for the DeepSeek-powered Socratic teaching system.
 *
 * Design:
 * - Pure functions: no fs/electron/IPC imports or side-effects.
 * - buildSystemPrompt(params) → the full system prompt string.
 * - buildMessages(params) → [system, ...windowed history, user] for DeepSeek.
 *
 * The system prompt is built from 6 segments (separated by \n\n---\n\n):
 *   1. Socratic rules
 *   2. Character profile (companion)
 *   3. World context
 *   4. Optional learner info
 *   5. Optional current textbook content (truncated)
 *   6. Narration / end-class / page-navigation / language rules
 */

import type { Companion } from '../../shared/schemas/companion'
import type { DeepSeekChatMessage } from '../llm/types'
import type { ClassMode } from '../../shared/types/ids'
import {
  getSocraticRules,
  getNarrationRules,
  getEndClassRule,
  getPageNavigationRule,
  getTeachingLanguageRule,
  getContextFirstRules,
  getPlainDialogueRules
} from './rules'
import { truncateToBudget, windowMessages } from './token-budget'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildSystemPromptParams {
  /** The companion (AI character) to role-play */
  companion: Companion
  /** World narrative context (world_preset.md content) */
  worldContext: string
  /** Optional learner profile information */
  learnerInfo?: string
  /** Optional current textbook/page content to teach from */
  textbookContent?: string
  /** Optional handoff tail from the previous session with this companion */
  handoffTail?: string
  /** Optional pal moments (cross-session teaching interaction notes) */
  palMoments?: string
  /** Optional relationship state between this companion and the learner */
  relationState?: string
  /** Optional teaching-coach assessment segment (pre-formatted string) */
  teachingCoachAssessment?: string
  /** Classroom mode: 'standard' Socratic dialogue or 'feynman' teach-back. */
  classMode?: ClassMode
  /** Hide narration/action descriptions — plain dialogue only. */
  hideNarration?: boolean
  /** Cross-chapter retrieved textbook passages (pre-formatted string). */
  relatedTextbook?: string
  /** Textbook title for citation attribution. */
  textbookTitle?: string
  /** Token budget for textbook content (default: 2000) */
  maxTextbookTokens?: number
  /** Teaching language code (default: 'zh') */
  language?: string
}

export interface BuildMessagesParams extends BuildSystemPromptParams {
  /** Windowed conversation history (recent messages) */
  history?: DeepSeekChatMessage[]
  /** The current user message to append */
  userMessage: string
  /** Token budget for history windowing (default: 3000) */
  maxHistoryTokens?: number
}

// ---------------------------------------------------------------------------
// Segment separator
// ---------------------------------------------------------------------------

const SEP = '\n\n---\n\n'

// ---------------------------------------------------------------------------
// Content sanitizer — prevents prompt injection from user-provided content
// ---------------------------------------------------------------------------

/**
 * Wraps user-provided content to prevent prompt injection via:
 * - Markdown headings (`## `) that could masquerade as system instructions
 * - Segment separators (`\n\n---\n\n`) that could create ghost segment boundaries
 * - Triple-backtick code blocks with instruction-injection payloads
 * - "Ignore previous rules" and similar directive text
 *
 * Strategy: strip `## ` from line starts (defuses heading injection) and
 * wrap in XML `<user-content>` tags (makes boundaries explicit so the LLM
 * can distinguish system instructions from reference material).
 */
export function wrapUserContent(content: string): string {
  const stripped = content.replace(/^## /gm, '')
  return `<user-content>\n${stripped}\n</user-content>`
}

// ---------------------------------------------------------------------------
// Segment builders
// ---------------------------------------------------------------------------

function buildCharacterSegment(companion: Companion): string {
  return [
    '## 你的角色设定',
    '',
    `**姓名**：${companion.name}`,
    `**性别**：${genderLabel(companion.gender)}`,
    `**年龄**：${companion.age}岁`,
    `**身份**：${companion.identity}`,
    `**性格关键词**：${companion.personalityKeywords.join('、')}`,
    '',
    wrapUserContent(companion.personality),
    '',
    wrapUserContent(companion.speakingStyle),
    '',
    wrapUserContent(companion.emotionalExpressions)
  ].join('\n')
}

function buildWorldSegment(worldContent: string): string {
  return [
    '## 你所在的世界',
    '',
    wrapUserContent(worldContent.trim())
  ].join('\n')
}

function buildLearnerSegment(learnerInfo: string): string {
  return [
    '## 关于学习者',
    '',
    wrapUserContent(learnerInfo.trim())
  ].join('\n')
}

function buildTextbookSegment(content: string): string {
  return [
    '## 本节课教材',
    '',
    wrapUserContent(content.trim())
  ].join('\n')
}

function buildRelatedTextbookSegment(content: string): string {
  return [
    '## 教材相关段落（跨章节检索）',
    '',
    '以下是针对当前讨论自动检索到的教材其他章节段落，供你在概念呼应、回顾前文或核对细节时使用。',
    '',
    wrapUserContent(content.trim())
  ].join('\n')
}

function buildCitationRulesSegment(textbookTitle: string): string {
  return [
    '## 教材引用格式',
    '',
    `引用《${textbookTitle}》的内容时，必须使用引用块（>）引用原文，并在引用前标注出处，格式：`,
    '',
    `【教材出处 · 《${textbookTitle}》 · 章节名】`,
    '',
    '只引用教材中真实存在的内容，绝不编造；找不到对应内容时如实说明教材没有涉及。'
  ].join('\n')
}

function buildFeynmanSegment(): string {
  return [
    '## 费曼回讲模式',
    '',
    '现在是费曼回讲课堂：学习者刚刚学完一段内容，你要扮演一个**充满好奇、理解还不牢靠的学徒**，',
    '帮助学习者通过"讲出来"检验自己的理解。',
    '',
    '规则：',
    '1. 你不再主动讲解知识，而是请学习者用他自己的话讲解刚才学的内容，从他真正讲起的地方开始。',
    '2. 你每次只追问一个问题，聚焦他讲解中含糊、跳跃或可能出错的地方',
    '（例如："为什么这一步成立？""这里是怎么推出来的？""能举个具体例子吗？"）。',
    '3. 当学习者的解释暴露出误区时，不要直接纠正——先用追问让他自己发现矛盾；',
    '如果他确实卡住，再给一句最简短的提示，并请他重新讲一遍确认理解。',
    '4. 保持真诚的学徒人设：不懂就问，不装懂，不奉承，不替学习者把话说完。',
    '5. 仍然遵守旁白与格式规则，且每条消息依然只问一个问题。'
  ].join('\n')
}

function buildHandoffSegment(tail: string): string {
  return [
    '## 上次课堂接力',
    '',
    '以下是上次课堂结束时记录的上下文摘要，帮助你延续之前的教学：',
    '',
    wrapUserContent(tail.trim())
  ].join('\n')
}

function buildPalMomentsSegment(content: string): string {
  return [
    '## 教学互动备忘',
    '',
    '以下是以往课堂中记录的关键教学互动，帮助你了解学习者的历史表现：',
    '',
    wrapUserContent(content.trim())
  ].join('\n')
}

function buildRelationSegment(content: string): string {
  return [
    '## 与学习者的关系',
    '',
    '以下是你与学习者当前的关系状态描述：',
    '',
    wrapUserContent(content.trim())
  ].join('\n')
}

function buildFormatRulesSegment(language: string, hideNarration?: boolean): string {
  const narrationSegment = hideNarration ? getPlainDialogueRules() : getNarrationRules()
  return [
    narrationSegment,
    '',
    getEndClassRule(),
    '',
    getPageNavigationRule(),
    '',
    getContextFirstRules(),
    '',
    getTeachingLanguageRule(language)
  ].join('\n\n')
}

function genderLabel(gender: string): string {
  switch (gender) {
    case 'male': return '男'
    case 'female': return '女'
    default: return '其他'
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the full system prompt for a Socratic teaching session.
 *
 * The prompt is assembled from up to 10 segments joined by `\n\n---\n\n`.
 * Textbook content is truncated to `maxTextbookTokens` if provided.
 */
export function buildSystemPrompt(params: BuildSystemPromptParams): string {
  const {
    companion,
    worldContext,
    learnerInfo,
    textbookContent,
    handoffTail,
    palMoments,
    relationState,
    classMode,
    relatedTextbook,
    textbookTitle,
    hideNarration,
    maxTextbookTokens = 2000,
    language = 'zh'
  } = params

  const segments: string[] = [
    getSocraticRules(),
    buildCharacterSegment(companion),
    buildWorldSegment(worldContext)
  ]

  // Optional learner info
  if (learnerInfo) {
    segments.push(buildLearnerSegment(learnerInfo))
  }

  // Optional textbook content (truncated)
  if (textbookContent) {
    const truncated = truncateToBudget(textbookContent, maxTextbookTokens)
    segments.push(buildTextbookSegment(truncated))
    if (textbookTitle) {
      segments.push(buildCitationRulesSegment(textbookTitle))
    }
  }

  // Cross-chapter retrieved passages (whole-book teaching)
  if (relatedTextbook) {
    const truncated = truncateToBudget(relatedTextbook, 1400)
    segments.push(buildRelatedTextbookSegment(truncated))
  }

  // Feynman teach-back mode
  if (classMode === 'feynman') {
    segments.push(buildFeynmanSegment())
  }

  // Optional handoff tail from previous session
  if (handoffTail) {
    segments.push(buildHandoffSegment(handoffTail))
  }

  // Optional pal moments (cross-session teaching notes)
  if (palMoments) {
    segments.push(buildPalMomentsSegment(palMoments))
  }

  // Optional relationship state
  if (relationState) {
    segments.push(buildRelationSegment(relationState))
  }

  // Optional teaching-coach assessment (pre-formatted by teaching-coach.ts)
  if (params.teachingCoachAssessment) {
    segments.push(params.teachingCoachAssessment)
  }

  // Format and end-class rules (always last)
  segments.push(buildFormatRulesSegment(language, hideNarration))

  return segments.join(SEP)
}

/**
 * Build the full message array for a DeepSeek chat completion request.
 *
 * Returns `[system, ...windowed history, user]`.
 * History is windowed to `maxHistoryTokens`, and the system message
 * is always at index 0.
 */
export function buildMessages(params: BuildMessagesParams): DeepSeekChatMessage[] {
  const {
    history = [],
    userMessage,
    maxHistoryTokens = 3000,
    ...systemParams
  } = params

  const systemContent = buildSystemPrompt(systemParams)

  const windowed = windowMessages(history, maxHistoryTokens)

  return [
    { role: 'system', content: systemContent },
    ...windowed,
    { role: 'user', content: userMessage }
  ]
}
