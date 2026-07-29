/**
 * Artifact generation — calls DeepSeek to produce structured
 * lesson artifacts (summary, flashcards, diary, progress, handoff tail)
 * at the end of a class session.
 */

import { DeepSeekClient } from '../llm/deepseek-client'
import { createDeepSeekHttpAdapter } from '../llm/deepseek-http-adapter'
import type { Message } from '../../shared/schemas/message'
import { ArtifactType } from '../../shared/types/ids'

interface ArtifactResult {
  type: ArtifactType
  content: string
}

export interface ArtifactProviderConfig {
  apiKey: string
  model: string
  baseUrl: string
}

export interface ArtifactGenerationResult {
  results: ArtifactResult[]
  failures: Array<{ type: ArtifactType; error: string }>
}

/**
 * Generate all lesson artifacts for a completed conversation.
 *
 * Uses the non-streaming DeepSeek client to produce structured output
 * for each artifact type. Each artifact is generated independently
 * so a failure in one doesn't block the others.
 */
export async function generateArtifacts(
  messages: Message[],
  config: ArtifactProviderConfig
): Promise<ArtifactGenerationResult> {
  const endpoint = config.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const adapter = createDeepSeekHttpAdapter({ endpoint })
  const client = new DeepSeekClient(config.apiKey, adapter, config.model)
  const results: ArtifactResult[] = []
  const failures: Array<{ type: ArtifactType; error: string }> = []

  // Build conversation transcript for context
  const transcript = messages
    .map((m) => `${m.role === 'user' ? '学习者' : '导师'}: ${m.content}`)
    .join('\n\n')

  // Generate each artifact type in parallel
  const artifactTypes = [
    ArtifactType.LessonSummary,
    ArtifactType.Flashcards,
    ArtifactType.Diary,
    ArtifactType.Progress,
    ArtifactType.HandoffTail
  ]

  const generators = artifactTypes.map((type) =>
    generateArtifact(client, type, transcript)
  )

  const settled = await Promise.allSettled(generators)

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'fulfilled' && result.value) {
      results.push(result.value)
    } else if (result.status === 'rejected') {
      failures.push({
        type: artifactTypes[i],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      })
    }
  }

  return { results, failures }
}

async function generateArtifact(
  client: DeepSeekClient,
  type: ArtifactType,
  transcript: string
): Promise<ArtifactResult | null> {
  const prompt = buildArtifactPrompt(type)

  const response = await client.chat([
    { role: 'system', content: prompt },
    { role: 'user', content: transcript }
  ])

  if (!response.content) return null

  return { type, content: response.content.trim() }
}

function buildArtifactPrompt(type: ArtifactType): string {
  switch (type) {
    case ArtifactType.LessonSummary:
      return `你是一位教育助手。请根据以下苏格拉底式课堂对话，生成一份简洁的课堂总结。
总结应包含：
1. 本节课探讨的核心主题
2. 学习者展现出的理解亮点
3. 仍需要进一步思考的问题

用中文回答，控制在 200 字以内。`

    case ArtifactType.Flashcards:
      return `你是一位教育助手。请根据以下苏格拉底式课堂对话，生成 3-5 张记忆卡片（flashcards）。
每张卡片格式：
- 问题：(一个关键概念问题)
- 答案：(简洁的答案)

用中文回答，使用 Markdown 格式。`

    case ArtifactType.Diary:
      return `你是一位教育助手。请以学习者的第一人称视角，写一篇简短的课后日记（100-150 字）。
日记应反映：
- 今天学到了什么
- 有什么新的认识或感悟
- 还想继续探索的问题

用中文回答。`

    case ArtifactType.Progress:
      return `你是一位教育助手。请根据以下课堂对话，评估学习者的学习进展。
输出格式：
- 理解程度：(初学/理解/掌握/深入)
- 思维能力：(观察到的思维特点)
- 建议下一步：(推荐的学习方向)

用中文回答，控制在 150 字以内。`

    case ArtifactType.HandoffTail:
      return `你是一位教育助手。请根据以下课堂对话，生成一段"接力尾巴"——即下次课堂开始时，导师应该知道的上下文摘要。
包括：
- 上次讨论到哪里了
- 学习者当前的理解状态
- 建议下次从哪里继续

用中文回答，控制在 100 字以内。`
  }
}
