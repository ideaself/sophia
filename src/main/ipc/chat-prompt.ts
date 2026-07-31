import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Companion } from '../../shared/schemas/companion'
import { CompanionSchema } from '../../shared/schemas/companion'
import type { DeepSeekChatMessage } from '../llm/types'
import { buildMessages } from '../prompt/prompt-builder'
import { readWorldData } from '../storage/world-store'
import { TextbookStore } from '../storage/textbook-store'
import { ConversationStore } from '../storage/conversation-store'
import { ArtifactStore } from '../storage/artifact-store'
import { companionDir, palMomentsPath, relationPath, handoffMetaPath } from '../storage/app-data'
import type { WorldId } from '../../shared/types/ids'
import { IpcChatPromptMessagesInputSchema } from '../../shared/schemas/ipc'
import { compressMessages, shouldCompress, splitCompressionWindow } from '../prompt/message-compressor'
import { analyzeTeaching, shouldAnalyze, formatAssessment, type TeachingCoachAssessment } from '../prompt/teaching-coach'
import { retrievePassages, formatPassages } from '../prompt/textbook-retrieval'
import type { ProviderStore } from '../storage/provider-store'

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

    // 2. Load world context
    const worldData = await readWorldData(dataRoot, params.worldId)
    const worldContext = worldData?.story ?? ''
    const learnerInfo = worldData?.learnerProfile ?? undefined

    // 3. Load textbook content
    let textbookContent: string | undefined
    let textbookTitle: string | undefined
    if (params.textbookId) {
      textbookContent = await textbookStore.getContent(params.textbookId, params.worldId)
      textbookContent = textbookContent || undefined
      const tb = await textbookStore.get(params.textbookId, params.worldId)
      textbookTitle = tb?.title
    }

    // 4. Load handoff tail from the most recent ended conversation with the same companion
    const handoffTail = await loadHandoffTail(
      dataRoot,
      conversationStore,
      artifactStore,
      params.companionId,
      params.worldId,
      params.conversationId
    )

    // 4b. Load pal moments (cross-session teaching interaction notes)
    let palMoments: string | undefined
    try {
      const raw = await readFile(palMomentsPath(dataRoot, params.worldId), 'utf-8')
      palMoments = raw.trim() || undefined
    } catch { /* file doesn't exist yet */ }

    // 4c. Load relationship state for this companion
    let relationState: string | undefined
    try {
      const raw = await readFile(relationPath(dataRoot, params.companionId, params.worldId), 'utf-8')
      relationState = raw.trim() || undefined
    } catch { /* file doesn't exist yet */ }

    // 5. Load conversation history
    const messages = await conversationStore.getMessages(params.conversationId, params.worldId)
    const history: DeepSeekChatMessage[] = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))

    // 6. Compress early messages if conversation is very long
    if (shouldCompress(history) && providerStore) {
      try {
        const active = await providerStore.getActive()
        if (active) {
          const apiKey = await providerStore.readApiKey(active.id)
          if (apiKey) {
            const { toCompress, toKeep } = splitCompressionWindow(history)
            const windowSize = toCompress.filter((m) => m.role !== 'system').length
            const cached = compressionCache.get(params.conversationId)
            let summary: string | null = null

            if (cached && cached.windowSize === windowSize) {
              summary = cached.summary
            } else {
              summary = await compressMessages(toCompress, {
                apiKey,
                baseUrl: active.baseUrl || 'https://api.deepseek.com',
                model: active.selectedModel || 'deepseek-v4-flash'
              })
              if (summary) {
                compressionCache.set(params.conversationId, { windowSize, summary })
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

    // 7. Teaching-coach analysis (every ANALYSIS_INTERVAL user messages)
    const userMsgCount = history.filter((m) => m.role === 'user').length + 1 // +1 for the current message
    if (shouldAnalyze(userMsgCount) && providerStore) {
      try {
        const active = await providerStore.getActive()
        if (active) {
          const apiKey = await providerStore.readApiKey(active.id)
          if (apiKey) {
            let textbookTitle: string | undefined
            if (params.textbookId) {
              const tb = await textbookStore.get(params.textbookId, params.worldId)
              textbookTitle = tb?.title
            }
            const assessment = await analyzeTeaching(history, companion, textbookTitle, {
              apiKey,
              baseUrl: active.baseUrl || 'https://api.deepseek.com',
              model: active.selectedModel || 'deepseek-v4-flash'
            })
            if (assessment) {
              const round = userMsgCount / 4 // 4 = ANALYSIS_INTERVAL
              const segment = formatAssessment(assessment, round)
              coachCache.set(params.conversationId, { segment, round, contentProgress: assessment.contentProgress })
              console.log(`[teaching-coach] Analysis injected for ${params.conversationId} (round ${round})`)
            }
          }
        }
      } catch (err) {
        console.warn('[teaching-coach] Analysis failed (non-fatal):', err instanceof Error ? err.message : String(err))
      }
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
    if (textbookContent) {
      const recentTexts = [
        ...history.slice(-6).map((m) => m.content),
        params.userMessage
      ]
      const passages = retrievePassages(textbookContent, recentTexts, {
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
      worldContext,
      learnerInfo,
      textbookContent,
      relatedTextbook,
      classMode: params.classMode ?? 'standard',
      hideNarration: params.hideNarration,
      handoffTail,
      palMoments,
      relationState,
      teachingCoachAssessment: coachSegment,
      history,
      userMessage: params.userMessage,
      maxHistoryTokens: 3000,
      maxTextbookTokens: isSecondHalf ? 4000 : 2000
    })

    return builtMessages
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

async function loadHandoffTail(
  dataRoot: string,
  conversationStore: ConversationStore,
  artifactStore: ArtifactStore,
  companionId: string,
  worldId: string,
  excludeConversationId: string
): Promise<string | undefined> {
  // 1. Prefer structured metadata from handoff_meta.json — locate the
  //    exact previous conversation instead of guessing by endedAt.
  try {
    const metaRaw = await readFile(handoffMetaPath(dataRoot, worldId), 'utf-8')
    const meta = JSON.parse(metaRaw) as Record<string, { prevConvId: string }>
    const entry = meta[companionId]
    if (entry?.prevConvId && entry.prevConvId !== excludeConversationId) {
      const artifacts = await artifactStore.list(entry.prevConvId, worldId)
      const handoff = artifacts.find((a) => a.type === 'handoff_tail')
      if (handoff?.content) {
        return handoff.content
      }
    }
  } catch {
    // No metadata yet — fall through to the legacy search below.
  }

  // 2. Legacy fallback: most recent ended conversation with same companion.
  try {
    const conversations = await conversationStore.list(worldId)
    const ended = conversations
      .filter((c) => c.endedAt && c.companionId === companionId && c.id !== excludeConversationId)
      .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))

    for (const conv of ended) {
      const artifacts = await artifactStore.list(conv.id, worldId)
      const handoff = artifacts.find((a) => a.type === 'handoff_tail')
      if (handoff?.content) {
        return handoff.content
      }
    }
  } catch {
    // Best-effort
  }
  return undefined
}
