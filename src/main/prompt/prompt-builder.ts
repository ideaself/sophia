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
import {
  getSocraticRules,
  getNarrationRules,
  getEndClassRule,
  getPageNavigationRule,
  getTeachingLanguageRule
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

function buildFormatRulesSegment(language: string): string {
  return [
    getNarrationRules(),
    '',
    getEndClassRule(),
    '',
    getPageNavigationRule(),
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
  segments.push(buildFormatRulesSegment(language))

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
