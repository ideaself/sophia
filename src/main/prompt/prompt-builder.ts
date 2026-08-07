/**
 * Prompt builder — assembles the system prompt and chat messages
 * for the DeepSeek-powered Socratic teaching system.
 *
 * Design:
 * - Pure functions: no fs/electron/IPC imports or side-effects.
 * - buildSystemPrompt(params) → the full system prompt string.
 * - buildMessages(params) → [system, ...windowed history, user] for DeepSeek.
 *
 * The system prompt is built from 5 segments (separated by \n\n---\n\n):
 *   1. Socratic rules
 *   2. Character profile (companion)
 *   3. Optional learner info
 *   4. Optional current textbook content (truncated)
 *   5. Narration / end-class / page-navigation / language rules
 */

import type { Companion } from '../../shared/schemas/companion'
import type { DeepSeekChatMessage } from '../llm/types'
import type { ClassMode } from '../../shared/types/ids'
import {
  getSocraticRules,
  getLessonRhythmRules,
  getNarrationRules,
  getEndClassRule,
  getPageNavigationRule,
  getTeachingLanguageRule,
  getContextFirstRules,
  getPlainDialogueRules,
  getPaceRules,
  getChapterProgressionRule,
  getConceptSubjectRule,
  getAttentivenessRule
} from './rules'
import { truncateToBudget, windowMessages } from './token-budget'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildSystemPromptParams {
  /** The companion (AI character) to role-play */
  companion: Companion
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
  /** Teaching pace: 'slow' (Take It Slow), 'normal' (default), or 'fast'. */
  pace?: 'slow' | 'normal' | 'fast'
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
  /** Structured metadata from the previous ended session (time sense). */
  handoffMeta?: HandoffMetaInfo
  /** 概念掌握度提示段（里程碑 3，pre-formatted by shared/concept-mastery.ts）。 */
  conceptMastery?: string
}

/** Structured handoff metadata written at the end of the previous class. */
export interface HandoffMetaInfo {
  /** ISO timestamp when the previous class ended. */
  savedAt?: string
  /** Textbook page the previous class ended near (may be null). */
  endingPage?: number | null
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

function buildLearnerSegment(learnerInfo: string): string {
  return [
    '## 关于学习者',
    '',
    wrapUserContent(learnerInfo.trim()),
    '',
    '这份档案可能包含学习者过去在**其他学科**上的表现（如具体公式、章节、题目）。',
    '只参考其中的通用学习特征（习惯、风格、认知倾向）；如果档案内容与本节课教材主题不符，',
    '一律视为历史背景，**不得延续那些学科主题**，也不要主动提起或回顾。'
  ].join('\n')
}

function buildTextbookSegment(content: string): string {
  return [
    '## 本节课教材',
    '',
    wrapUserContent(content.trim()),
    '',
    '【主题权威】本节课只围绕这本教材展开教学：课堂主题、内容推进、提问与作业都以此为准。',
    '如果其他上下文（学习者档案、互动备忘、上次课堂接力等）中出现了与这本教材无关的历史学科内容，',
    '一律忽略，不得延续、回顾或混入本课。'
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

function relativeTimeLabel(savedAt: string): string {
  const then = new Date(savedAt)
  if (Number.isNaN(then.getTime())) return '上次'
  const days = Math.max(1, Math.round((Date.now() - then.getTime()) / (24 * 60 * 60 * 1000)))
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} 周前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  const years = Math.floor(days / 365)
  return `${years} 年前`
}

/**
 * Handoff timeline segment (1.0.8 / 2.0.0).
 * Grounds the previous class in "last time / previously" instead of
 * "today / just now", and prevents the new class from re-staging the
 * previous class's closing scene.
 */
function buildHandoffTimelineSegment(meta: HandoffMetaInfo): string {
  const when = meta.savedAt ? relativeTimeLabel(meta.savedAt) : '上次'
  const where = typeof meta.endingPage === 'number' && meta.endingPage > 0
    ? `，当时读到教材第 ${meta.endingPage} 页附近`
    : ''
  return [
    '## 上次课堂的时间与位置',
    '',
    `上次课堂结束于${when}${where}。`,
    '',
    '请据此把握时间感：',
    '1. 上次课堂的内容发生在「上次/之前」，不是「今天」或「刚才」——用词要准确区分时间间隔。',
    '2. 新课堂开场可以自然承接上次的学习话题，但**不要接续上次结尾的具体场景、画面或对话**，就像新的一天重新开始一样。',
    '3. 不要重复讲解上次已经讲过且学习者已经掌握的概念；需要时可以简要提醒上次讲到哪，而不是重讲一遍。'
  ].join('\n')
}

function buildPalMomentsSegment(content: string): string {
  return [
    '## 教学互动备忘',
    '',
    '以下是以往课堂中记录的关键教学互动，帮助你了解学习者的历史表现。',
    '其中可能包含历史学科的具体内容，只用于参考学习者的习惯与风格，',
    '**不要延续备忘里不属于本节课教材主题的内容**。',
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
    getChapterProgressionRule(),
    '',
    getConceptSubjectRule(),
    '',
    getAttentivenessRule(),
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
      learnerInfo,
    textbookContent,
    handoffTail,
    palMoments,
    relationState,
    classMode,
    pace,
    relatedTextbook,
    textbookTitle,
    hideNarration,
    maxTextbookTokens = 2000,
    language = 'zh'
  } = params

  const segments: string[] = [
    getSocraticRules(),
    getLessonRhythmRules(),
    buildCharacterSegment(companion)
  ]

  // Optional learner info
  if (learnerInfo) {
    segments.push(buildLearnerSegment(learnerInfo))
  }

  // Optional concept mastery state (里程碑 3): 学情注入 — 薄弱优先复习
  if (params.conceptMastery) {
    segments.push(params.conceptMastery)
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

  // Teaching pace (only when the learner explicitly chose non-default)
  if (pace === 'slow' || pace === 'fast') {
    segments.push(getPaceRules(pace))
  }

  // Optional handoff tail from previous session
  if (handoffTail) {
    segments.push(buildHandoffSegment(handoffTail))
  }

  // Optional handoff timeline — time sense + no scene pickup (1.0.8 / 2.0.0)
  if (params.handoffMeta) {
    segments.push(buildHandoffTimelineSegment(params.handoffMeta))
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
