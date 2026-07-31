/**
 * Artifact generation — calls DeepSeek to produce structured
 * lesson artifacts (summary, flashcards, diary, progress, handoff tail)
 * at the end of a class session.
 */

import { DeepSeekClient } from '../llm/deepseek-client'
import { createDeepSeekHttpAdapter } from '../llm/deepseek-http-adapter'
import type { Message } from '../../shared/schemas/message'
import { ArtifactType, type ClassMode } from '../../shared/types/ids'

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

export interface ArtifactGenerationOptions {
  classMode?: ClassMode
  /** Restrict generation to these artifact types (redo of missing items). */
  types?: ArtifactType[]
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
  config: ArtifactProviderConfig,
  options: ArtifactGenerationOptions = {}
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

  // Generate each artifact type with limited concurrency to avoid
  // triggering rate limits (429).  Process in batches of 3.
  const CONCURRENCY = 3
  let artifactTypes: ArtifactType[]
  if (options.types && options.types.length > 0) {
    artifactTypes = options.types
  } else {
    artifactTypes = [
      ArtifactType.LessonSummary,
      ArtifactType.Flashcards,
      ArtifactType.Diary,
      ArtifactType.Progress,
      ArtifactType.HandoffTail,
      ArtifactType.Farewell,
      ArtifactType.LearnerProfile,
      ArtifactType.PalMoments,
      ArtifactType.Relation,
      ArtifactType.CompanionNote
    ]
    if (options.classMode === 'feynman') {
      artifactTypes.push(ArtifactType.FeynmanNote)
    }
  }

  const generators = artifactTypes.map((type) =>
    generateArtifact(client, type, transcript)
  )

  const settled: PromiseSettledResult<ArtifactResult | null>[] = []
  for (let i = 0; i < generators.length; i += CONCURRENCY) {
    const batch = generators.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(batch)
    settled.push(...batchResults)
  }

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
4. 2-3 道自测题（供学习者课后自检，答案逐步揭晓）：
   每道自测题格式：
   **自测 N：<问题>**
   - 提示 1：<第一个线索，只指向思考方向，不要直接给答案>
   - 提示 2：<第二个线索，更接近答案>
   - 答案：<完整答案，放在最后>

要求：
- 自测题必须基于本节课真实讨论过的内容，不要出课堂之外的题；
- 提示要循序渐进，让学习者先尝试作答再看提示；
- 答案放在最后，并保持简洁。
用中文回答，控制在 450 字以内。`

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
      return `你是一位教育助手。请根据以下课堂对话，生成一段"接力尾巴"--即下次课堂开始时，导师应该知道的上下文摘要。
包括：
- 上次讨论到哪里了
- 学习者当前的理解状态
- 建议下次从哪里继续

用中文回答，控制在 100 字以内。`

    case ArtifactType.Farewell:
      return `你是一位教育助手。请根据以下课堂对话，以学习伙伴的口吻写一段简短的告别语（50-100 字）。
要求：
- 自然温暖，符合角色性格
- 可以回顾本节课的一个亮点
- 以期待下次见面结尾
- 不要使用旁白格式（不要用星号包裹动作描述）

用中文回答。`

    case ArtifactType.LearnerProfile:
      return `你是一位教育助手。请根据以下课堂对话，更新对学习者的画像评估。
输出格式（Markdown）：
- 认知水平：（初学/理解/掌握/深入，附简要说明）
- 薄弱点：（学习者在哪些概念上表现出困难）
- 学习习惯：（被动跟随/主动提问/善于反思/容易跑题等）
- 进展趋势：（相比之前是否有进步，如果是第一节课就写"首次课堂"）
- 教学建议：（后续教学应注意的事项）

用中文回答，控制在 200 字以内。只输出画像内容，不要附加说明。`

    case ArtifactType.PalMoments:
      return `你是一位教育助手。请根据以下课堂对话，生成一条教学互动备忘（pal moment）。
格式要求：
## YYYY-MM-DD | 伙伴名
（内容段）

内容应记录：
- 学习者的难点或困惑
- 伙伴的关键讲解或引导
- 突破时刻或重要问答
- 讨论的主要主题

铁律：必须基于真实对话内容，绝不虚构未发生的内容。
如果对话很短或学习者几乎没说话，只写一句陈述事实。
用中文回答，控制在 150 字以内。使用今天的真实日期。`

    case ArtifactType.Relation:
      return `你是一位教育助手。请根据以下课堂对话，更新学习伙伴与学习者之间的关系状态描述。
内容应反映：
- 伙伴与学习者关系的变化（更亲近/更信任/更默契等）
- 学习者对伙伴的态度
- 互动氛围

如果关系无明显变化，输出"无变化"。
限制：≤ 150 字。
用中文回答。只输出关系描述，不要附加说明。`

    case ArtifactType.CompanionNote:
      return `你是一位教育助手。请以学习伙伴的视角，写一段内心独白（不展示给学习者）。
要求：
- 反映伙伴对学习者本次表现的内心看法
- ≤ 80 字符
- 纯文本，不要使用旁白星号格式
用中文回答。只输出独白内容。`

    case ArtifactType.FeynmanNote:
      return `你是一位教育助手。这是费曼回讲课堂的对话记录——学习者向"好奇学徒"讲解了自己学到的内容，学徒进行了追问。
请提炼一枚"知识蛋"，格式（Markdown）：
## 学习者讲解了什么
（2-3 句概括学习者用自己的话讲出的核心内容）

## 讲得清楚的地方
（列出学习者解释准确、举出好例子的点）

## 暴露的误区或含糊处
（列出学徒追问后发现的理解漏洞，逐一说明）

## 下次追问方向
（下次回讲或复习时应优先确认的 1-2 个问题）

铁律：必须基于对话中的真实内容，绝不虚构学习者没有讲过的东西。
如果对话很短或学习者几乎没讲，只写一句陈述事实即可。
用中文回答，控制在 250 字以内。只输出知识蛋内容。`

    default: {
      const _exhaustive: never = type
      throw new Error(`Unknown artifact type: ${_exhaustive}`)
    }
  }
}
