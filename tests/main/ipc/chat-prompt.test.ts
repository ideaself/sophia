/**
 * chat-prompt.ts IPC integration tests — the classroom prompt assembly path
 * (companion, learner profile, textbook region, handoff tail, relationship
 * state, concept mastery) against a temp data root with real stores.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

type Handler = (event: unknown, input?: unknown) => Promise<unknown>

const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      mocks.handlers.set(channel, fn)
    }
  }
}))

import { registerChatPromptIpc, clearConversationPromptCaches } from '../../../src/main/ipc/chat-prompt'
import { registerConversationIpc } from '../../../src/main/ipc/data'
import { ProviderStore } from '../../../src/main/storage/provider-store'
import { ConversationStore } from '../../../src/main/storage/conversation-store'
import { TextbookStore } from '../../../src/main/storage/textbook-store'
import { ArtifactStore } from '../../../src/main/storage/artifact-store'
import { loadReferenceCompanions } from '../../../src/main/companions/reference-loader'
import {
  companionDir,
  learnerPath,
  palMomentsPath,
  relationPath,
  handoffMetaPath
} from '../../../src/main/storage/app-data'
import type { SafeStorageAdapter } from '../../../src/main/security/secure-key-store'

const projectsRoot = join(__dirname, '..', '..', '..')
const candidatesDir = join(projectsRoot, 'reference', '角色设定', 'candidates')

const fakeSafeStorage: SafeStorageAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf8')
}

let dataRoot = ''
let conversations: ConversationStore
let textbooks: TextbookStore
let artifacts: ArtifactStore
let providerStore: ProviderStore

async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return (await handler({}, input)) as T
}

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-prompt-'))
  mocks.handlers.clear()

  conversations = new ConversationStore(dataRoot)
  textbooks = new TextbookStore(dataRoot)
  artifacts = new ArtifactStore(dataRoot)
  providerStore = new ProviderStore(dataRoot, fakeSafeStorage)

  // Real preset companions, loaded into the temp data root.
  await loadReferenceCompanions({ candidatesDir, companionDir: companionDir(dataRoot) })

  registerConversationIpc(dataRoot, providerStore)
  registerChatPromptIpc(dataRoot, providerStore)
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('chat:get-prompt-messages', () => {
  it('assembles companion + history + learner profile into prompt messages', async () => {
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '物理课'
    })
    await conversations.addMessage(conv.id, 'user', '什么是熵？')
    await conversations.addMessage(conv.id, 'assistant', '熵是状态函数。')

    await writeFile(learnerPath(dataRoot), '# 学习者\n喜欢从直觉出发。', 'utf-8')
    await writeFile(relationPath(dataRoot, 'comp_landau'), '关系：彼此信任。', 'utf-8')
    await writeFile(palMomentsPath(dataRoot), '上次聊到统计物理。', 'utf-8')

    const messages = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      {
        conversationId: conv.id,
        companionId: 'comp_landau',
        userMessage: '那第二定律呢？'
      }
    )

    expect(messages.length).toBeGreaterThanOrEqual(3)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('朗道')
    expect(messages[0].content).toContain('喜欢从直觉出发')
    expect(messages[0].content).toContain('关系：彼此信任')
    expect(messages[0].content).toContain('上次聊到统计物理')

    const last = messages[messages.length - 1]
    expect(last).toEqual({ role: 'user', content: '那第二定律呢？' })
    expect(messages.some((m) => m.content === '什么是熵？')).toBe(true)
  })

  it('throws for an unknown companion', async () => {
    const conv = await conversations.create({
      companionId: 'comp_missing',
      companionVersion: 1,
      textbookId: null,
      title: 'x'
    })
    await expect(
      invoke('chat:get-prompt-messages', {
        conversationId: conv.id,
        companionId: 'comp_missing',
        userMessage: 'hi'
      })
    ).rejects.toThrow(/Companion not found/)
  })

  it('injects the textbook region and cross-chapter retrieval', async () => {
    const tb = await textbooks.create({
      title: '热力学讲义',
      author: '',
      description: '',
      format: 'markdown',
      content: [
        '# 第一章 温度',
        '温度是分子平均动能的度量。'.repeat(60),
        '# 第二章 熵',
        '熵是状态函数，孤立系统永不减少。'.repeat(60)
      ].join('\n\n')
    })
    await textbooks.updateProgress(tb.id, { currentPage: 1, totalPages: 4 })

    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: tb.id,
      title: '带教材'
    })

    const messages = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      {
        conversationId: conv.id,
        companionId: 'comp_landau',
        textbookId: tb.id,
        userMessage: '熵为什么会增加？',
        classMode: 'standard',
        pace: 'normal',
        hideNarration: true
      }
    )

    const system = messages[0].content
    expect(system).toContain('热力学讲义')
    expect(system).toContain('熵')
  })

  it('prefers the stored handoff tail for the same companion + textbook', async () => {
    const previous = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '上一课'
    })
    await conversations.endConversation(previous.id)
    await artifacts.create(previous.id, 'handoff_tail', '上次停在卡诺循环。')

    await mkdir(join(dataRoot, 'learned'), { recursive: true })
    await writeFile(
      handoffMetaPath(dataRoot),
      JSON.stringify({
        comp_landau: {
          savedAt: new Date().toISOString(),
          prevConvId: previous.id,
          companionName: '朗道',
          companionSlot: null,
          endingPage: 3,
          textbookId: null
        }
      }),
      'utf-8'
    )

    const current = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '新一课'
    })

    const messages = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      {
        conversationId: current.id,
        companionId: 'comp_landau',
        userMessage: '继续上次'
      }
    )
    expect(messages[0].content).toContain('上次停在卡诺循环')
  })

  it('clearConversationPromptCaches is safe for unknown conversations', () => {
    expect(() => clearConversationPromptCaches('conv_unknown')).not.toThrow()
    expect(existsSync(dataRoot)).toBe(true)
  })
})

describe('ai:compose-answer', () => {
  it('requires a configured provider', async () => {
    await expect(
      invoke('ai:compose-answer', { question: '什么是熵？', history: '' })
    ).rejects.toThrow(/未配置模型服务/)
  })

  it('requires an API key once a provider exists', async () => {
    const created = await providerStore.create({
      name: 'DeepSeek',
      type: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: ''
    })
    await providerStore.update(created.id, { isActive: true })
    await providerStore.deleteApiKey(created.id)

    await expect(
      invoke('ai:compose-answer', { question: '什么是熵？', history: '' })
    ).rejects.toThrow(/未配置 API Key/)
  })
})
