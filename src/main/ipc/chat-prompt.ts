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
import { companionDir } from '../storage/app-data'
import type { WorldId } from '../../shared/types/ids'
import { compressMessages, shouldCompress, splitCompressionWindow } from '../prompt/message-compressor'
import { analyzeTeaching, shouldAnalyze, formatAssessment, type TeachingCoachAssessment } from '../prompt/teaching-coach'
import type { ProviderStore } from '../storage/provider-store'

// ---------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------

interface PromptMessagesInput {
  conversationId: string
  companionId: string
  textbookId?: string | null
  userMessage: string
  worldId: string
}

function validateInput(input: unknown): PromptMessagesInput {
  const raw = input as Record<string, unknown>
  if (!raw.conversationId || typeof raw.conversationId !== 'string') {
    throw new Error('conversationId is required')
  }
  if (!raw.companionId || typeof raw.companionId !== 'string') {
    throw new Error('companionId is required')
  }
  if (!raw.userMessage || typeof raw.userMessage !== 'string') {
    throw new Error('userMessage is required')
  }
  return {
    conversationId: raw.conversationId,
    companionId: raw.companionId,
    textbookId: (raw.textbookId as string) ?? null,
    userMessage: raw.userMessage,
    worldId: (raw.worldId as string) ?? 'world_default'
  }
}

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
  const coachCache = new Map<string, { segment: string; round: number }>()

  ipcMain.handle('chat:get-prompt-messages', async (_event, input: unknown) => {
    const params = validateInput(input)

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
    if (params.textbookId) {
      textbookContent = await textbookStore.getContent(params.textbookId, params.worldId)
      textbookContent = textbookContent || undefined
    }

    // 4. Load handoff tail from the most recent ended conversation with the same companion
    const handoffTail = await loadHandoffTail(
      conversationStore,
      artifactStore,
      params.companionId,
      params.worldId,
      params.conversationId
    )

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
            const summary = await compressMessages(toCompress, {
              apiKey,
              baseUrl: active.baseUrl || 'https://api.deepseek.com',
              model: active.selectedModel || 'deepseek-v4-flash'
            })
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
              coachCache.set(params.conversationId, { segment, round })
              console.log(`[teaching-coach] Analysis injected for ${params.conversationId} (round ${round})`)
            }
          }
        }
      } catch (err) {
        console.warn('[teaching-coach] Analysis failed (non-fatal):', err instanceof Error ? err.message : String(err))
      }
    }

    // Retrieve cached assessment (from this turn or a previous one)
    const coachSegment = coachCache.get(params.conversationId)?.segment

    // 8. Build messages with system prompt
    const builtMessages = buildMessages({
      companion,
      worldContext,
      learnerInfo,
      textbookContent,
      handoffTail,
      teachingCoachAssessment: coachSegment,
      history,
      userMessage: params.userMessage,
      maxHistoryTokens: 3000
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
  conversationStore: ConversationStore,
  artifactStore: ArtifactStore,
  companionId: string,
  worldId: string,
  excludeConversationId: string
): Promise<string | undefined> {
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
