import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Companion } from '../../shared/schemas/companion'
import { CompanionSchema } from '../../shared/schemas/companion'
import type { DeepSeekChatMessage } from '../llm/types'
import { buildMessages, type HandoffMetaInfo } from '../prompt/prompt-builder'
import { readLocalContext } from '../storage/world-store'
import { TextbookStore } from '../storage/textbook-store'
import { ConversationStore } from '../storage/conversation-store'
import { ArtifactStore } from '../storage/artifact-store'
import { companionDir, palMomentsPath, palMomentsPathForTextbook, relationPath, handoffMetaPath } from '../storage/app-data'
import { IpcChatPromptMessagesInputSchema, IpcAiComposeInputSchema } from '../../shared/schemas/ipc'
import { compressMessages, splitCompressionWindowByTokens } from '../prompt/message-compressor'
import { analyzeTeaching, shouldAnalyze, formatAssessment, ANALYSIS_INTERVAL } from '../prompt/teaching-coach'
import {
  retrievePassages,
  formatPassages,
  extractRegionAroundProgress
} from '../prompt/textbook-retrieval'
import type { ProviderStore } from '../storage/provider-store'
import { DeepSeekClient } from '../llm/deepseek-client'
import { createDeepSeekHttpAdapter } from '../llm/deepseek-http-adapter'
import { estimateTokens } from '../prompt/token-budget'

// ---------------------------------------------------------------
// Registration
// ---------------------------------------------------------------

/**
 * Register the chat:get-prompt-messages IPC handler.
 *
 * This handler orchestrates all context loading and prompt assembly:
 * 1. Load full companion data (personality, speakingStyle, emotionalExpressions)
 * 2. Load world context (story.md) and learner info (learner.md)
 * 3. Load textbook content (source.md)
 * 4. Load conversation history from messages.json
 * 5. Call buildMessages() to assemble the full message array
 * 6. Return the messages array for streaming to DeepSeek
 */
export function registerChatPromptIpc(dataRoot: string, providerStore?: ProviderStore): void {
  const textbookStore = new TextbookStore(dataRoot)
  const conversationStore = new ConversationStore(dataRoot)
  const artifactStore = new ArtifactStore(dataRoot)

  // Cache the latest teaching-coach assessment per conversation so it
  // persists between turns until the next analysis interval triggers.
  // { formatted segment string, round number }
  const coachCache = new Map<string, { segment: string; round: number; contentProgress: string }>()
  // 防止异步教练分析叠加（同一会话同时只跑一个）
  const coachAnalysisInFlight = new Set<string>()

  // Cache compressed summaries per conversation to avoid re-calling the
  // LLM on every turn.  Keyed by the number of messages in the compression
  // window - if the window hasn't grown, the summary is reused.
  const compressionCache = new Map<string, { windowSize: number; summary: string }>()

  ipcMain.handle('chat:get-prompt-messages', async (_event, input: unknown) => {
    const params = IpcChatPromptMessagesInputSchema.parse(input)

    // 1. Load full companion data
    const companion = await loadCompanion(dataRoot, params.companionId)
    if (!companion) {
      throw new Error(`Companion not found: ${params.companionId}`)
    }

    // 2. Load learner profile (learner.md)
    const worldData = await readLocalContext(dataRoot)
    const learnerInfo = worldData?.learnerProfile ?? undefined

    // 3. Load textbook content
    let textbookContent: string | undefined
    let textbookTitle: string | undefined
    let progressFraction: number | null = null
    if (params.textbookId) {
      textbookContent = await textbookStore.getContent(params.textbookId)
      textbookContent = textbookContent || undefined
      const tb = await textbookStore.get(params.textbookId)
      textbookTitle = tb?.title
      const p = tb?.progress
      if (p && typeof p.totalPages === 'number' && p.totalPages > 0 && typeof p.currentPage === 'number' && p.currentPage > 0) {
        progressFraction = Math.min(1, p.currentPage / p.totalPages)
      } else if (p && typeof p.readingPercentage === 'number' && p.readingPercentage > 0) {
        progressFraction = Math.min(1, p.readingPercentage)
      }
    }

    // Keep the full content for cross-chapter retrieval, but teach from the
    // learner's current position: the region starting at the current section.
    const fullTextbookContent = textbookContent
    if (textbookContent) {
      textbookContent = extractRegionAroundProgress(textbookContent, progressFraction, 2200)
    }

    // 4. Load handoff tail from the most recent ended conversation with the
    //    same companion AND the same textbook — 接力尾巴按教材隔离，换教材
    //    上新课时绝不能延续旧教材的课堂内容（旧实现只按伙伴 id 取）。
    const handoff = await loadHandoffTail(
      dataRoot,
      conversationStore,
      artifactStore,
      params.companionId,
      params.conversationId,
      params.textbookId ?? null
    )
    const handoffTail = handoff.tail

    // 4b. Load pal moments (cross-session teaching interaction notes).
    //     按教材隔离：有教材的课堂只读该教材专属的备忘文件，避免上一门
    //     课（如傅里叶光学）的互动内容串进新教材（微积分）课堂。
    const palMoments = await loadPalMoments(dataRoot, params.textbookId ?? null)

    // 4c. Load relationship state for this companion
    let relationState: string | undefined
    try {
      const raw = await readFile(relationPath(dataRoot, params.companionId), 'utf-8')
      relationState = raw.trim() || undefined
    } catch { /* file doesn't exist yet */ }

    // 5. Load conversation history
    const messages = await conversationStore.getMessages(params.conversationId)
    const history: DeepSeekChatMessage[] = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))

    // 6. Compress early messages when the conversation outgrows the history
    //    window — pure windowing would silently drop early context (模型失忆).
    //    Trigger on token volume, not message count: classrooms rarely reach
    //    150 messages but easily blow past the token budget.
    const historyTokens = history.reduce((sum, m) => sum + estimateTokens(m.content), 0)
    const HISTORY_WINDOW = 8000
    const COMPRESS_THRESHOLD = 12000
    if (historyTokens > COMPRESS_THRESHOLD && providerStore) {
      try {
        const active = await providerStore.getActive()
        if (active) {
          const apiKey = await providerStore.readApiKey(active.id)
          if (apiKey) {
            const { toCompress, toKeep } = splitCompressionWindowByTokens(history, HISTORY_WINDOW)
            const cacheKey = `${params.conversationId}:${toCompress.length}`
            const cached = compressionCache.get(cacheKey)
            let summary: string | null = null

            if (cached) {
              summary = cached.summary
            } else {
              summary = await compressMessages(toCompress, {
                apiKey,
                baseUrl: active.baseUrl || 'https://api.deepseek.com',
                model: active.selectedModel || 'deepseek-v4-flash'
              })
              if (summary) {
                compressionCache.set(cacheKey, { windowSize: toCompress.length, summary })
              }
            }

            if (summary) {
              const compressionMsg: DeepSeekChatMessage = {
                role: 'system',
                content: `【早期对话摘要】\n${summary}\n\n以上是早期对话的摘要。当前对话从以下内容继续：`
              }
              history.splice(0, history.length, compressionMsg, ...toKeep)
            }
          }
        }
      } catch (err) {
        console.warn('Failed to compress conversation history:', err)
      }
    }

    // 7. Teaching-coach analysis (every ANALYSIS_INTERVAL user messages).
    //    异步执行，不阻塞本次发送：结果写入 coachCache，从后续轮次注入。
    //    （教练分析是建议性的，晚一两轮到达无副作用；同步等待会让
    //    发送按钮长时间卡住——旧实现每第 4 条消息卡一次发送。）
    const userMsgCount = history.filter((m) => m.role === 'user').length + 1 // +1 for the current message
    if (shouldAnalyze(userMsgCount) && providerStore && !coachAnalysisInFlight.has(params.conversationId)) {
      coachAnalysisInFlight.add(params.conversationId)
      void (async () => {
        try {
          const active = await providerStore!.getActive()
          if (active) {
            const apiKey = await providerStore!.readApiKey(active.id)
            if (apiKey) {
              const assessment = await analyzeTeaching(history, companion, textbookTitle, {
                apiKey,
                baseUrl: active.baseUrl || 'https://api.deepseek.com',
                model: active.selectedModel || 'deepseek-v4-flash'
              })
              if (assessment) {
                const round = userMsgCount / ANALYSIS_INTERVAL
                const segment = formatAssessment(assessment, round)
                coachCache.set(params.conversationId, { segment, round, contentProgress: assessment.contentProgress })
                console.log(`[teaching-coach] Analysis injected for ${params.conversationId} (round ${round})`)
              }
            }
          }
        } catch (err) {
          console.warn('[teaching-coach] Analysis failed (non-fatal):', err instanceof Error ? err.message : String(err))
        } finally {
          coachAnalysisInFlight.delete(params.conversationId)
        }
      })()
    }

    // Retrieve cached assessment (from this turn or a previous one)
    const coachEntry = coachCache.get(params.conversationId)
    const coachSegment = coachEntry?.segment
    // When the learner enters the second half of the textbook, expand the
    // token budget so the AI gets more context from later chapters.
    const isSecondHalf = coachEntry?.contentProgress === 'second_half'

    // 7b. Cross-chapter retrieval — find relevant passages anywhere in the
    // textbook from the recent conversation + current message. Deterministic,
    // no extra LLM call.
    let relatedTextbook: string | undefined
    if (fullTextbookContent) {
      const recentTexts = [
        ...history.slice(-6).map((m) => m.content),
        params.userMessage
      ]
      const passages = retrievePassages(fullTextbookContent, recentTexts, {
        maxPassages: 3,
        maxExcerptChars: 300
      })
      if (passages.length > 0) {
        relatedTextbook = formatPassages(passages, textbookTitle)
      }
    }

    // 8. Build messages with system prompt
    const builtMessages = buildMessages({
      companion,
      learnerInfo,
      textbookContent,
      relatedTextbook,
      textbookTitle,
      classMode: params.classMode ?? 'standard',
      pace: params.pace,
      hideNarration: params.hideNarration,
      handoffTail,
      handoffMeta: handoff.meta,
      palMoments,
      relationState,
      teachingCoachAssessment: coachSegment,
      history,
      userMessage: params.userMessage,
      maxHistoryTokens: HISTORY_WINDOW,
      maxTextbookTokens: isSecondHalf ? 4000 : 2000
    })

    return builtMessages
  })

  // AI 代答 (3.2.0) — compose a draft reply the learner can paste/send, as a
  // model answer / hint. Uses the learner's first-person voice.
  ipcMain.handle('ai:compose-answer', async (_event, input: unknown) => {
    const params = IpcAiComposeInputSchema.parse(input)
    const active = providerStore ? await providerStore.getActive() : null
    if (!active) throw new Error('未配置模型服务')
    const apiKey = await providerStore!.readApiKey(active.id)
    if (!apiKey) throw new Error('未配置 API Key，请在设置中添加')

    const endpoint = (active.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '') + '/chat/completions'
    const client = new DeepSeekClient(apiKey, createDeepSeekHttpAdapter({ endpoint }), active.selectedModel || 'deepseek-v4-flash')

    const system = [
      '你是学习者的代答助手。根据课堂上下文，用学习者第一人称起草一段简短、自然的回答。',
      '目的：帮助学习者示范如何回应导师（AI 学习伙伴）的提问，或者作为答不上来时的提示。',
      '要求：',
      '1. 像真人说话：简洁、口语化，不必追求完美，可以表达不确定。',
      '2. 直接回应导师的问题，如果问题明确就先给出你的理解/思路。',
      '3. 只输出回答本身，不要任何额外说明、不要用星号旁白、不要自称是 AI。',
      '4. 控制在 150 字以内。'
    ].join('\n')
    const context = params.history
      ? `最近的课堂对话：\n${params.history}`
      : '（没有历史上下文）'
    const userMsg = `导师的问题是：${params.question}\n\n${context}`

    const response = await client.chat([
      { role: 'system', content: system },
      { role: 'user', content: userMsg }
    ])
    return { content: (response.content ?? '').trim() }
  })
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

async function loadCompanion(dataRoot: string, companionId: string): Promise<Companion | null> {
  try {
    const indexPath = join(companionDir(dataRoot), 'index.json')
    const content = await readFile(indexPath, 'utf-8')
    const companions = CompanionSchema.array().parse(JSON.parse(content)) as Companion[]
    return companions.find((c) => c.id === companionId) ?? null
  } catch {
    return null
  }
}

/** 读取教学互动备忘：有教材读专属文件，无教材读全局文件。 */
export async function loadPalMoments(
  dataRoot: string,
  textbookId: string | null
): Promise<string | undefined> {
  const filePath = textbookId
    ? palMomentsPathForTextbook(dataRoot, textbookId)
    : palMomentsPath(dataRoot)
  try {
    const raw = await readFile(filePath, 'utf-8')
    return raw.trim() || undefined
  } catch {
    return undefined
  }
}

export async function loadHandoffTail(
  dataRoot: string,
  conversationStore: ConversationStore,
  artifactStore: ArtifactStore,
  companionId: string,
  excludeConversationId: string,
  textbookId: string | null
): Promise<{ tail?: string; meta?: HandoffMetaInfo }> {
  // 1. Prefer structured metadata from handoff_meta.json — locate the
  //    exact previous conversation instead of guessing by endedAt.
  //    接力尾巴必须来自同一教材的上一课；meta 无 textbookId 字段的旧记录
  //    视为不匹配，回退到下面的按教材过滤的 legacy 搜索。
  try {
    const metaRaw = await readFile(handoffMetaPath(dataRoot), 'utf-8')
    const meta = JSON.parse(metaRaw) as Record<string, (HandoffMetaInfo & { prevConvId: string; textbookId?: string | null })>
    const entry = meta[companionId]
    if (
      entry?.prevConvId &&
      entry.prevConvId !== excludeConversationId &&
      entry.textbookId === textbookId
    ) {
      const artifacts = await artifactStore.list(entry.prevConvId)
      const handoff = artifacts.find((a) => a.type === 'handoff_tail')
      if (handoff?.content) {
        return {
          tail: handoff.content,
          meta: { savedAt: entry.savedAt, endingPage: entry.endingPage }
        }
      }
    }
  } catch {
    // No metadata yet — fall through to the legacy search below.
  }

  // 2. Legacy fallback: most recent ended conversation with same companion
  //    and the same textbook.
  try {
    const conversations = await conversationStore.list()
    const ended = conversations
      .filter((c) =>
        c.endedAt &&
        c.companionId === companionId &&
        c.id !== excludeConversationId &&
        (c.textbookId ?? null) === textbookId
      )
      .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))

    for (const conv of ended) {
      const artifacts = await artifactStore.list(conv.id)
      const handoff = artifacts.find((a) => a.type === 'handoff_tail')
      if (handoff?.content) {
        return {
          tail: handoff.content,
          meta: conv.endedAt ? { savedAt: conv.endedAt, endingPage: null } : undefined
        }
      }
    }
  } catch {
    // Best-effort
  }
  return {}
}
