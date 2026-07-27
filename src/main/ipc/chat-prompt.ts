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
import { companionDir } from '../storage/app-data'
import type { WorldId } from '../../shared/types/ids'

// ---------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------

interface PromptMessagesInput {
  conversationId: string
  companionId: string
  textbookId?: string | null
  userMessage: string
  worldId?: string
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
export function registerChatPromptIpc(dataRoot: string): void {
  const textbookStore = new TextbookStore(dataRoot)
  const conversationStore = new ConversationStore(dataRoot)

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

    // 4. Load conversation history
    const messages = await conversationStore.getMessages(params.conversationId, params.worldId)
    const history: DeepSeekChatMessage[] = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))

    // 5. Build messages with system prompt
    const builtMessages = buildMessages({
      companion,
      worldContext,
      learnerInfo,
      textbookContent,
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
    const companions = CompanionSchema.array().parse(JSON.parse(content))
    return companions.find((c) => c.id === companionId) ?? null
  } catch {
    return null
  }
}
