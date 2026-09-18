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

const llm = vi.hoisted(() => ({
  chat: vi.fn((_messages: Array<{ role: string; content: string }>) =>
    Promise.resolve({ content: '' })
  ),
  clients: [] as Array<{ apiKey: string; model: string }>
}))

vi.mock('../../../src/main/llm/deepseek-client', () => ({
  DeepSeekClient: class {
    constructor(apiKey: string, _adapter: unknown, model: string) {
      llm.clients.push({ apiKey, model })
    }
    chat(messages: Array<{ role: string; content: string }>): Promise<{ content: string }> {
      return llm.chat(messages) as Promise<{ content: string }>
    }
  }
}))

import { registerChatPromptIpc, clearConversationPromptCaches } from '../../../src/main/ipc/chat-prompt'
import { registerConversationIpc } from '../../../src/main/ipc/data'
import { ProviderStore } from '../../../src/main/storage/provider-store'
import { ConversationStore } from '../../../src/main/storage/conversation-store'
import { TextbookStore } from '../../../src/main/storage/textbook-store'
import { ArtifactStore } from '../../../src/main/storage/artifact-store'
import { ConceptStore } from '../../../src/main/learning-memory/concept-store'
import { loadReferenceCompanions } from '../../../src/main/companions/reference-loader'
import {
  companionDir,
  configDir,
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
  llm.chat.mockReset().mockResolvedValue({ content: '' })
  llm.clients.length = 0

  conversations = new ConversationStore(dataRoot)
  textbooks = new TextbookStore(dataRoot)
  artifacts = new ArtifactStore(dataRoot)
  providerStore = new ProviderStore(dataRoot, fakeSafeStorage)

  // Real preset companions, loaded into the temp data root.
  await loadReferenceCompanions({ candidatesDir, companionDir: companionDir(dataRoot) })

  registerConversationIpc(dataRoot, providerStore)
  registerChatPromptIpc(dataRoot, providerStore)
})

/** Activate a provider with a stored API key. */
async function withProvider(): Promise<void> {
  const provider = await providerStore.create({
    name: 'DeepSeek',
    type: 'deepseek',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-live',
    models: ['deepseek-v4-flash'],
    selectedModel: 'deepseek-v4-flash'
  })
  await providerStore.update(provider.id, { isActive: true })
}

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

// ---------------------------------------------------------------
// Provider-powered paths (DeepSeekClient mocked)
// ---------------------------------------------------------------

describe('chat:get-prompt-messages — compression and coaching', () => {
  it('compresses an over-long history once and reuses the summary', async () => {
    await withProvider()
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '长课'
    })
    await conversations.addMessage(conv.id, 'user', '开场问题')
    await conversations.addMessage(conv.id, 'assistant', '长回答'.repeat(10_000))

    llm.chat.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      if (messages[0].content.includes('压缩')) {
        return { content: '【压缩摘要】早前讨论了熵与第二定律。' }
      }
      return { content: '' }
    })

    const first = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      { conversationId: conv.id, companionId: 'comp_landau', userMessage: '继续' }
    )

    // The compressed window carries the summary plus the kept tail (the
    // summary rides in the history as the first message, not the system prompt).
    expect(first.some((m) => m.content.includes('【早期对话摘要】'))).toBe(true)
    expect(first.some((m) => m.content.includes('早前讨论了熵与第二定律'))).toBe(true)

    const compressCalls = llm.chat.mock.calls.filter((c) =>
      (c[0] as Array<{ content: string }>)[0].content.includes('压缩')
    ).length
    expect(compressCalls).toBe(1)

    // A second identical request hits the compression cache.
    await invoke('chat:get-prompt-messages', {
      conversationId: conv.id,
      companionId: 'comp_landau',
      userMessage: '再继续'
    })
    const compressCallsAfter = llm.chat.mock.calls.filter((c) =>
      (c[0] as Array<{ content: string }>)[0].content.includes('压缩')
    ).length
    expect(compressCallsAfter).toBe(1)
  })

  it('injects the teaching-coach assessment on the next turn', async () => {
    await withProvider()
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '教练'
    })
    for (let i = 0; i < 3; i++) {
      await conversations.addMessage(conv.id, 'user', `问题 ${i + 1}`)
      await conversations.addMessage(conv.id, 'assistant', `回答 ${i + 1}`)
    }

    llm.chat.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      if (messages[0].content.includes('教学教练')) {
        return {
          content: JSON.stringify({
            companionBehavior: 'normal',
            learnerEngagement: 'curious',
            contentProgress: 'second_half',
            currentFocus: '熵',
            qualityFlags: ['示例提醒']
          })
        }
      }
      return { content: '' }
    })

    // 3 user messages + the current one = round 4 → analysis kicks off async.
    await invoke('chat:get-prompt-messages', {
      conversationId: conv.id,
      companionId: 'comp_landau',
      userMessage: '第四个问题'
    })
    await vi.waitFor(() => {
      const coachCalls = llm.chat.mock.calls.filter((c) =>
        (c[0] as Array<{ content: string }>)[0].content.includes('教学教练')
      )
      expect(coachCalls.length).toBe(1)
    })

    const second = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      { conversationId: conv.id, companionId: 'comp_landau', userMessage: '第五个问题' }
    )
    expect(second[0].content).toContain('教学教练分析')
    expect(second[0].content).toContain('第 1 轮')
    expect(second[0].content).toContain('当前焦点：熵')
  })

  it('skips learner profile, textbook content and relation extras when they are absent', async () => {
    // No learner.md, empty textbook content and a whitespace-only relation
    // file: every optional segment must degrade to "absent", not to junk.
    const empty = await textbooks.create({
      title: '空教材',
      author: '',
      description: '',
      format: 'markdown',
      content: ''
    })
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: empty.id,
      title: '空'
    })
    await writeFile(relationPath(dataRoot, 'comp_landau'), '   \n', 'utf-8')

    const messages = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      {
        conversationId: conv.id,
        companionId: 'comp_landau',
        textbookId: empty.id,
        userMessage: '开始'
      }
    )

    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every((m) => !m.content.includes('   \n'))).toBe(true)
  })

  it('skips compression when no provider is active', async () => {
    // A provider exists but is not selected: the long history must pass through
    // uncompressed and no model call may happen.
    await providerStore.create({
      name: 'DeepSeek',
      type: 'deepseek',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-live',
      models: ['deepseek-v4-flash'],
      selectedModel: 'deepseek-v4-flash'
    })
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '未激活'
    })
    await conversations.addMessage(conv.id, 'user', '开场问题')
    await conversations.addMessage(conv.id, 'assistant', '长回答'.repeat(10_000))

    await invoke('chat:get-prompt-messages', {
      conversationId: conv.id,
      companionId: 'comp_landau',
      userMessage: '继续'
    })

    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('skips compression when the active provider has no API key', async () => {
    const provider = await providerStore.create({
      name: 'DeepSeek',
      type: 'deepseek',
      baseUrl: 'https://api.example.com',
      apiKey: '',
      models: [],
      selectedModel: ''
    })
    await providerStore.update(provider.id, { isActive: true })
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '无密钥'
    })
    await conversations.addMessage(conv.id, 'user', '开场问题')
    await conversations.addMessage(conv.id, 'assistant', '长回答'.repeat(10_000))

    await invoke('chat:get-prompt-messages', {
      conversationId: conv.id,
      companionId: 'comp_landau',
      userMessage: '继续'
    })

    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('keeps the raw history when the model returns no usable summary', async () => {
    await withProvider()
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '空摘要'
    })
    await conversations.addMessage(conv.id, 'user', '开场问题')
    await conversations.addMessage(conv.id, 'assistant', '长回答'.repeat(10_000))

    // Default mock answers { content: '' } → compression yields no summary.
    const messages = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      { conversationId: conv.id, companionId: 'comp_landau', userMessage: '继续' }
    )

    expect(messages.some((m) => m.content.includes('【早期对话摘要】'))).toBe(false)
    expect(messages.some((m) => m.content.includes('长回答'))).toBe(true)
  })

  it('skips coaching analysis when no provider is active or no key is stored', async () => {
    // Round 4 triggers analysis; with an inactive provider (and then no key)
    // the background task must bail out quietly.
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '无教练'
    })
    for (let i = 0; i < 3; i++) {
      await conversations.addMessage(conv.id, 'user', `问题 ${i + 1}`)
      await conversations.addMessage(conv.id, 'assistant', `回答 ${i + 1}`)
    }

    await invoke('chat:get-prompt-messages', {
      conversationId: conv.id,
      companionId: 'comp_landau',
      userMessage: '第四个问题'
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Same round in a second conversation, this time with an active provider
    // that has no stored API key.
    const provider = await providerStore.create({
      name: 'DeepSeek',
      type: 'deepseek',
      baseUrl: 'https://api.example.com',
      apiKey: '',
      models: [],
      selectedModel: ''
    })
    await providerStore.update(provider.id, { isActive: true })
    const conv2 = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '无密钥教练'
    })
    for (let i = 0; i < 3; i++) {
      await conversations.addMessage(conv2.id, 'user', `问题 ${i + 1}`)
      await conversations.addMessage(conv2.id, 'assistant', `回答 ${i + 1}`)
    }

    await invoke('chat:get-prompt-messages', {
      conversationId: conv2.id,
      companionId: 'comp_landau',
      userMessage: '第四个问题'
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('ignores an unusable coaching assessment and falls back to default endpoint/model', async () => {
    // Empty baseUrl/selectedModel + invalid model output: the fallbacks are
    // used for the request and a null assessment is never injected.
    const provider = await providerStore.create({
      name: 'DeepSeek',
      type: 'deepseek',
      baseUrl: '',
      apiKey: 'sk-live',
      models: [],
      selectedModel: ''
    })
    await providerStore.update(provider.id, { isActive: true })
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '坏评估'
    })
    for (let i = 0; i < 3; i++) {
      await conversations.addMessage(conv.id, 'user', `问题 ${i + 1}`)
      await conversations.addMessage(conv.id, 'assistant', `回答 ${i + 1}`)
    }

    await invoke('chat:get-prompt-messages', {
      conversationId: conv.id,
      companionId: 'comp_landau',
      userMessage: '第四个问题'
    })
    await vi.waitFor(() => expect(llm.chat).toHaveBeenCalled(), { timeout: 10_000 })

    const next = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      { conversationId: conv.id, companionId: 'comp_landau', userMessage: '第五个问题' }
    )
    expect(next[0].content).not.toContain('教学教练分析')
  })

  it('logs a non-Error coaching failure instead of crashing the turn', async () => {
    await withProvider()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '分析炸了'
    })
    for (let i = 0; i < 3; i++) {
      await conversations.addMessage(conv.id, 'user', `问题 ${i + 1}`)
      await conversations.addMessage(conv.id, 'assistant', `回答 ${i + 1}`)
    }

    llm.chat.mockRejectedValueOnce('boom')
    await invoke('chat:get-prompt-messages', {
      conversationId: conv.id,
      companionId: 'comp_landau',
      userMessage: '第四个问题'
    })

    await vi.waitFor(
      () =>
        expect(warn).toHaveBeenCalledWith(
          '[teaching-coach] Analysis failed (non-fatal):',
          'boom'
        ),
      { timeout: 10_000 }
    )
  })

  it('rejects compose-answer when no provider store is registered', async () => {
    registerChatPromptIpc(dataRoot)
    await expect(invoke('ai:compose-answer', { question: '为什么？' })).rejects.toThrow(
      '未配置模型服务'
    )
  })

  it('compose-answer falls back to the default endpoint and model', async () => {
    const provider = await providerStore.create({
      name: 'DeepSeek',
      type: 'deepseek',
      baseUrl: '',
      apiKey: 'sk-live',
      models: [],
      selectedModel: ''
    })
    await providerStore.update(provider.id, { isActive: true })
    llm.chat.mockResolvedValueOnce({ content: '因为熵增。' })

    const answer = await invoke<{ content: string }>('ai:compose-answer', {
      question: '为什么时间不可逆？',
      history: '学习者: 热力学第二定律是什么？'
    })

    expect(answer.content).toBe('因为熵增。')
  })

  it('retrieves related textbook passages from the recent conversation', async () => {
    const tb = await textbooks.create({
      title: '热力学讲义',
      author: '',
      description: '',
      format: 'markdown',
      content: [
        '# 第一章 温度',
        '温度是分子平均动能的度量。'.repeat(20),
        '# 第二章 熵',
        '熵是状态函数，孤立系统的熵永不减少。卡诺循环给出了效率上限。'.repeat(20),
        '# 第三章 热机',
        '热机把热量转化为功，效率受第二定律约束。'.repeat(20)
      ].join('\n\n')
    })
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: tb.id,
      title: '检索'
    })
    await conversations.addMessage(conv.id, 'user', '卡诺循环的效率怎么算？')
    await conversations.addMessage(conv.id, 'assistant', '先看热机的上限。')

    const messages = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      {
        conversationId: conv.id,
        companionId: 'comp_landau',
        textbookId: tb.id,
        userMessage: '那熵呢？'
      }
    )

    expect(messages[0].content).toContain('【相关教材段落 1')
    expect(messages[0].content).toContain('热力学讲义')
  })

  it('falls back to the legacy handoff search when no meta file exists', async () => {
    const older = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '更早的一课'
    })
    await conversations.endConversation(older.id)
    await artifacts.create(older.id, 'handoff_tail', '更早的接力尾巴：停在温度。')

    // A later timestamp so the newest ended class is unambiguous.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const previous = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '上一课'
    })
    await conversations.endConversation(previous.id)
    await artifacts.create(previous.id, 'handoff_tail', '旧版接力尾巴：停在卡诺循环。')

    const current = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '新一课'
    })

    const messages = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      { conversationId: current.id, companionId: 'comp_landau', userMessage: '继续' }
    )
    expect(messages[0].content).toContain('旧版接力尾巴')
    expect(messages[0].content).not.toContain('更早的接力尾巴')
  })
})

describe('chat-prompt — concepts, failures and cache invalidation', () => {
  it('injects this class’s concepts plus weak cross-session concepts', async () => {
    const tb = await textbooks.create({
      title: '热力学',
      author: '',
      description: '',
      format: 'markdown',
      content: '# 第一章 熵\n\n熵是状态函数。'
    })
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: tb.id,
      title: '概念课'
    })

    const concepts = new ConceptStore(dataRoot)
    await concepts.applyEvidence({
      conversationId: conv.id,
      textbookId: tb.id,
      messageIds: ['m1', 'm2'],
      updates: [{ name: '熵', performance: 'correct' }]
    })
    await concepts.applyEvidence({
      conversationId: 'conv_other',
      textbookId: tb.id,
      messageIds: ['m3', 'm4'],
      updates: [{ name: '卡诺循环', performance: 'incorrect', misconception: '混淆效率与功率' }]
    })
    // A second miss pushes mastery below the weak-concept threshold.
    await concepts.applyEvidence({
      conversationId: 'conv_other',
      textbookId: tb.id,
      messageIds: ['m3b', 'm4b'],
      updates: [{ name: '卡诺循环', performance: 'incorrect', misconception: '混淆效率与功率' }]
    })
    // Same name as the local concept → never duplicated.
    await concepts.applyEvidence({
      conversationId: 'conv_other_2',
      textbookId: tb.id,
      messageIds: ['m5', 'm6'],
      updates: [{ name: '熵', performance: 'incorrect' }]
    })

    const messages = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      {
        conversationId: conv.id,
        companionId: 'comp_landau',
        textbookId: tb.id,
        userMessage: '继续'
      }
    )

    const system = messages[0].content
    expect(system).toContain('卡诺循环')
    expect(system).toContain('混淆效率与功率')
  })

  it('keeps the class running when the concept store is unreadable', async () => {
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: 'tb_x',
      title: '概念存储坏'
    })
    await mkdir(join(dataRoot, 'concepts.json'), { recursive: true })

    const messages = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      { conversationId: conv.id, companionId: 'comp_landau', userMessage: '继续' }
    )

    expect(messages.length).toBeGreaterThanOrEqual(2)
  })

  it('uses the reading percentage fallback when page counts are missing', async () => {
    const tb = await textbooks.create({
      title: '按比例',
      author: '',
      description: '',
      format: 'markdown',
      content: '# 第一章 温度\n\n' + '温度是分子平均动能的度量。'.repeat(40)
    })
    await textbooks.updateProgress(tb.id, { readingPercentage: 0.66 })
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: tb.id,
      title: '比例'
    })

    const messages = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      {
        conversationId: conv.id,
        companionId: 'comp_landau',
        textbookId: tb.id,
        userMessage: '继续'
      }
    )

    expect(messages[0].content).toContain('按比例')
  })

  it('reports an unreadable companion index as not found', async () => {
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '坏索引'
    })
    await writeFile(join(companionDir(dataRoot), 'index.json'), '{broken', 'utf-8')

    await expect(
      invoke('chat:get-prompt-messages', {
        conversationId: conv.id,
        companionId: 'comp_landau',
        userMessage: 'hi'
      })
    ).rejects.toThrow(/Companion not found/)
  })

  it('survives a failing history compression', async () => {
    await withProvider()
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '压缩失败'
    })
    await conversations.addMessage(conv.id, 'user', '开场问题')
    await conversations.addMessage(conv.id, 'assistant', '长回答'.repeat(10_000))

    llm.chat.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      if (messages[0].content.includes('压缩')) throw new Error('compress down')
      return { content: '' }
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const messages = await invoke<Array<{ role: string; content: string }>>(
        'chat:get-prompt-messages',
        { conversationId: conv.id, companionId: 'comp_landau', userMessage: '继续' }
      )
      expect(messages.length).toBeGreaterThan(0)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to compress conversation history'),
        expect.anything()
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('survives a failing teaching-coach analysis', async () => {
    await withProvider()
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '教练失败'
    })
    for (let i = 0; i < 3; i++) {
      await conversations.addMessage(conv.id, 'user', `问题 ${i + 1}`)
      await conversations.addMessage(conv.id, 'assistant', `回答 ${i + 1}`)
    }

    llm.chat.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      if (messages[0].content.includes('教学教练')) throw new Error('coach down')
      return { content: '' }
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await invoke('chat:get-prompt-messages', {
        conversationId: conv.id,
        companionId: 'comp_landau',
        userMessage: '第四个问题'
      })
      await vi.waitFor(() =>
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Analysis failed (non-fatal)'),
          'coach down'
        )
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('drops the cached summary when the conversation caches are cleared', async () => {
    await withProvider()
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '缓存清理'
    })
    await conversations.addMessage(conv.id, 'user', '开场问题')
    await conversations.addMessage(conv.id, 'assistant', '长回答'.repeat(10_000))

    llm.chat.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      if (messages[0].content.includes('压缩')) return { content: '【压缩摘要】摘要' }
      return { content: '' }
    })

    const countCompressCalls = (): number =>
      llm.chat.mock.calls.filter((c) =>
        (c[0] as Array<{ content: string }>)[0].content.includes('压缩')
      ).length

    await invoke('chat:get-prompt-messages', {
      conversationId: conv.id,
      companionId: 'comp_landau',
      userMessage: '继续'
    })
    expect(countCompressCalls()).toBe(1)

    clearConversationPromptCaches(conv.id)

    await invoke('chat:get-prompt-messages', {
      conversationId: conv.id,
      companionId: 'comp_landau',
      userMessage: '再继续'
    })
    expect(countCompressCalls()).toBe(2)
  })
})

describe('ai:compose-answer — provider-powered path', () => {
  it('drafts a reply through the active provider', async () => {
    await withProvider()
    llm.chat.mockResolvedValue({ content: '  我的理解是熵是无序度。  ' })

    const result = await invoke<{ content: string }>('ai:compose-answer', {
      question: '什么是熵？',
      history: '学习者: 熵是什么？'
    })

    expect(result.content).toBe('我的理解是熵是无序度。')
    const call = llm.chat.mock.calls.at(-1)![0] as Array<{ role: string; content: string }>
    expect(call[0].content).toContain('代答助手')
    expect(call[1].content).toContain('什么是熵？')
    expect(llm.clients.at(-1)).toEqual({ apiKey: 'sk-live', model: 'deepseek-v4-flash' })
  })
})

describe('chat-prompt — fallback branches', () => {
  it('omits optional segments when the files are missing or empty', async () => {
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '空上下文'
    })
    // Empty relation file and no learner/pal files at all.
    await mkdir(join(dataRoot, 'learned'), { recursive: true })
    await writeFile(relationPath(dataRoot, 'comp_landau'), '   ', 'utf-8')

    const messages = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      { conversationId: conv.id, companionId: 'comp_landau', userMessage: '继续' }
    )

    expect(messages[0].content).not.toContain('## 与学习者的关系')
  })

  it('skips provider-powered segments when the stored key is gone', async () => {
    await withProvider()
    const conv = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '无钥匙'
    })
    await conversations.addMessage(conv.id, 'user', '问题')
    await conversations.addMessage(conv.id, 'assistant', '回答'.repeat(5000))

    const providerStoreLocal = new ProviderStore(dataRoot, fakeSafeStorage)
    const active = await providerStoreLocal.getActive()
    await rm(join(configDir(dataRoot), `${active!.id}.key.enc`), { force: true })
    llm.chat.mockClear()

    const messages = await invoke<Array<{ role: string; content: string }>>(
      'chat:get-prompt-messages',
      { conversationId: conv.id, companionId: 'comp_landau', userMessage: '继续' }
    )

    expect(messages.length).toBeGreaterThan(0)
    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('uses the default model when the active provider has none', async () => {
    const providerStoreLocal = new ProviderStore(dataRoot, fakeSafeStorage)
    const provider = await providerStoreLocal.create({
      name: 'NoModel',
      type: 'deepseek',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-nomodel',
      models: [],
      selectedModel: ''
    })
    await providerStoreLocal.update(provider.id, { isActive: true })
    llm.chat.mockResolvedValue({ content: '  答案  ' })

    await invoke('ai:compose-answer', { question: '什么是熵？', history: '' })

    expect(llm.clients.at(-1)).toMatchObject({ model: 'deepseek-v4-flash' })
  })

  it('handles an empty history and an empty model response', async () => {
    await withProvider()
    llm.chat.mockResolvedValueOnce({} as never)

    const result = await invoke<{ content: string }>('ai:compose-answer', {
      question: '什么是熵？',
      history: ''
    })

    expect(result.content).toBe('')
    const call = llm.chat.mock.calls.at(-1)![0] as Array<{ content: string }>
    expect(call[1].content).toContain('没有历史上下文')
  })

  it('ignores handoff meta without a stored handoff tail', async () => {
    const previous = await conversations.create({
      companionId: 'comp_landau',
      companionVersion: 1,
      textbookId: null,
      title: '上一课'
    })
    await conversations.endConversation(previous.id)
    await mkdir(join(dataRoot, 'learned'), { recursive: true })
    await writeFile(
      handoffMetaPath(dataRoot),
      JSON.stringify({
        comp_landau: {
          savedAt: new Date().toISOString(),
          prevConvId: previous.id,
          companionName: '朗道',
          companionSlot: null,
          endingPage: null,
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
      { conversationId: current.id, companionId: 'comp_landau', userMessage: '继续' }
    )

    expect(messages[0].content).not.toContain('接力')
  })
})
