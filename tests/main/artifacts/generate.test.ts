/**
 * generateArtifacts — per-type prompt construction, concurrency batching,
 * failure isolation, transcript sectioning and option plumbing.
 *
 * The LLM is injected: DeepSeekClient is replaced by a recorder whose chat()
 * delegates to a hoisted mock, so no network or key handling is involved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const llm = vi.hoisted(() => ({
  chat: vi.fn(),
  clients: [] as Array<{ apiKey: string; model: string; adapter: unknown }>
}))

vi.mock('../../../src/main/llm/deepseek-client', () => ({
  DeepSeekClient: class {
    constructor(apiKey: string, adapter: unknown, model: string) {
      llm.clients.push({ apiKey, model, adapter })
    }
    chat(messages: unknown): Promise<{ content: string }> {
      return llm.chat(messages) as Promise<{ content: string }>
    }
  }
}))

vi.mock('../../../src/main/llm/deepseek-http-adapter', () => ({
  createDeepSeekHttpAdapter: (opts: unknown) => ({ kind: 'http', opts })
}))

import { generateArtifacts } from '../../../src/main/artifacts/generate'
import { ArtifactType } from '../../../src/shared/types/ids'
import type { Message } from '../../../src/shared/schemas/message'

type ChatCall = Array<{ role: string; content: string }>

function messages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg_${i}`,
    conversationId: 'conv_1',
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `第 ${i + 1} 条消息的内容`,
    createdAt: '2026-09-16T10:00:00.000Z'
  })) as Message[]
}

function calls(): ChatCall[] {
  return llm.chat.mock.calls.map((c) => c[0] as ChatCall)
}

/** The user message of the call whose system prompt contains `marker`. */
function userContentFor(marker: string): string {
  const call = calls().find((c) => c[0]?.content.includes(marker))
  if (!call) throw new Error(`no chat call matched marker: ${marker}`)
  return call[1].content
}

const config = { apiKey: 'sk-test', model: 'deepseek-v4-flash', baseUrl: 'https://api.example.com' }

beforeEach(() => {
  llm.chat.mockReset().mockResolvedValue({ content: '  生成的内容  ' })
  llm.clients.length = 0
})

describe('generateArtifacts — happy path', () => {
  it('generates every default artifact type through one configured client', async () => {
    const result = await generateArtifacts(messages(6), config)

    expect(result.failures).toEqual([])
    const types = result.results.map((r) => r.type)
    expect(types).toEqual([
      ArtifactType.LessonSummary,
      ArtifactType.Flashcards,
      ArtifactType.Diary,
      ArtifactType.Progress,
      ArtifactType.HandoffTail,
      ArtifactType.Farewell,
      ArtifactType.LearnerProfile,
      ArtifactType.PalMoments,
      ArtifactType.Relation,
      ArtifactType.CompanionNote,
      ArtifactType.KnowledgeGraph,
      ArtifactType.LessonAudio,
      ArtifactType.LessonTimeline,
      ArtifactType.LessonFaq
    ])
    // Content is trimmed, one system+user pair per artifact.
    expect(result.results.every((r) => r.content === '生成的内容')).toBe(true)
    expect(llm.chat).toHaveBeenCalledTimes(14)
    expect(calls().every((c) => c.length === 2 && c[0].role === 'system' && c[1].role === 'user')).toBe(true)

    expect(llm.clients).toHaveLength(1)
    expect(llm.clients[0].apiKey).toBe('sk-test')
    expect(llm.clients[0].model).toBe('deepseek-v4-flash')
    expect(llm.clients[0].adapter).toEqual({
      kind: 'http',
      opts: { endpoint: 'https://api.example.com/chat/completions' }
    })
  })

  it('adds the feynman note in feynman classes and strips trailing slashes on the base URL', async () => {
    const result = await generateArtifacts(messages(6), {
      ...config,
      baseUrl: 'https://api.example.com/'
    }, { classMode: 'feynman' })

    expect(result.results.map((r) => r.type)).toContain(ArtifactType.FeynmanNote)
    expect(llm.chat).toHaveBeenCalledTimes(15)
    expect(llm.clients[0].adapter).toEqual({
      kind: 'http',
      opts: { endpoint: 'https://api.example.com/chat/completions' }
    })
  })

  it('restricts generation to the requested types', async () => {
    const result = await generateArtifacts(messages(6), config, {
      types: [ArtifactType.LessonSummary, ArtifactType.Flashcards]
    })

    expect(result.results.map((r) => r.type)).toEqual([
      ArtifactType.LessonSummary,
      ArtifactType.Flashcards
    ])
    expect(llm.chat).toHaveBeenCalledTimes(2)
  })

  it('skips artifacts the model leaves empty without reporting a failure', async () => {
    llm.chat.mockResolvedValue({ content: '   ' })

    const result = await generateArtifacts(messages(6), config, {
      types: [ArtifactType.Diary]
    })

    expect(result.results).toEqual([])
    expect(result.failures).toEqual([])
  })
})

describe('generateArtifacts — failure isolation', () => {
  it('records failures per type while the rest still complete', async () => {
    llm.chat.mockImplementation(async (call: ChatCall) => {
      if (call[0].content.includes('记忆卡片')) throw new Error('429 rate limited')
      return { content: '好内容' }
    })

    const result = await generateArtifacts(messages(6), config, {
      types: [ArtifactType.LessonSummary, ArtifactType.Flashcards, ArtifactType.Diary]
    })

    expect(result.failures).toEqual([{ type: ArtifactType.Flashcards, error: '429 rate limited' }])
    expect(result.results.map((r) => r.type).sort()).toEqual(
      [ArtifactType.LessonSummary, ArtifactType.Diary].sort()
    )
  })

  it('stringifies non-Error rejections', async () => {
    llm.chat.mockRejectedValue('offline')

    const result = await generateArtifacts(messages(6), config, {
      types: [ArtifactType.Diary]
    })

    expect(result.failures).toEqual([{ type: ArtifactType.Diary, error: 'offline' }])
  })
})

describe('generateArtifacts — prompt plumbing', () => {
  it('scales the flashcard target with the class length', async () => {
    await generateArtifacts(messages(6), config, { types: [ArtifactType.Flashcards] })
    expect(userContentFor('记忆卡片')).toBeDefined()
    const shortPrompt = calls()[0][0].content
    expect(shortPrompt).toContain('3-5 张')

    llm.chat.mockClear()
    await generateArtifacts(messages(35), config, { types: [ArtifactType.Flashcards] })
    expect(calls()[0][0].content).toContain('5-8 张')

    llm.chat.mockClear()
    await generateArtifacts(messages(60), config, { types: [ArtifactType.Flashcards] })
    expect(calls()[0][0].content).toContain('8-10 张')
  })

  it('appends reading notes to the diary transcript only', async () => {
    await generateArtifacts(messages(6), config, {
      types: [ArtifactType.Diary, ArtifactType.Progress],
      readingNotes: '- 第二章：熵不减'
    })

    expect(userContentFor('课后日记')).toContain('【教材阅读批注】\n- 第二章：熵不减')
    expect(userContentFor('评估学习者的学习进展')).not.toContain('【教材阅读批注】')
  })

  it('sections long transcripts into 开头/中间/结尾 with speaker labels', async () => {
    await generateArtifacts(messages(60), config, { types: [ArtifactType.LessonSummary] })
    const longTranscript = calls()[0][1].content

    expect(longTranscript).toContain('【课堂开头】')
    expect(longTranscript).toContain('【课堂中间】')
    expect(longTranscript).toContain('【课堂结尾】')
    expect(longTranscript).toContain('学习者: 第 1 条消息的内容')
    expect(longTranscript).toContain('导师: 第 2 条消息的内容')

    llm.chat.mockClear()
    await generateArtifacts(messages(20), config, { types: [ArtifactType.LessonSummary] })
    const shortTranscript = calls()[0][1].content
    expect(shortTranscript).not.toContain('【课堂开头】')
  })
})
