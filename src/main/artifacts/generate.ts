/**
 * Artifact generation — calls DeepSeek to produce structured
 * lesson artifacts (summary, flashcards, diary, progress, handoff tail)
 * at the end of a class session.
 */

import { DeepSeekClient } from '../llm/deepseek-client'
import { createDeepSeekHttpAdapter } from '../llm/deepseek-http-adapter'
import type { Message } from '../../shared/schemas/message'
import { parseFlashcards } from '../../shared/flashcard-utils'
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
  /** 本课教材的阅读批注文本（供日记参考），可选。 */
  readingNotes?: string
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

  // Build conversation transcript for context. For long classes the
  // transcript is sectioned (start / middle / end) so the summary and other
  // artifacts remember the whole session, not just the ending (4.5.0).
  const transcript = buildTranscript(messages)

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
      ArtifactType.CompanionNote,
      ArtifactType.KnowledgeGraph,
      ArtifactType.LessonAudio,
      ArtifactType.LessonTimeline,
      ArtifactType.LessonFaq
    ]
    if (options.classMode === 'feynman') {
      artifactTypes.push(ArtifactType.FeynmanNote)
    }
  }

  // Flashcard count scales with how much was actually taught (4.0.1).
  const msgCount = messages.length
  const cardTarget = msgCount >= 60 ? '8-10 张' : msgCount >= 30 ? '5-8 张' : '3-5 张'

  const generators = artifactTypes.map((type) =>
    generateArtifact(
      client,
      type,
      transcript,
      type === ArtifactType.Flashcards ? cardTarget : undefined,
      type === ArtifactType.Diary ? options.readingNotes : undefined
    )
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

/** Classes longer than this get their transcript split into 三段. */
const LONG_CLASS_MESSAGES = 40

/**
 * Build the conversation transcript. Long conversations are sectioned into
 * 「课堂开头 / 课堂中间 / 课堂结尾」 so generation keeps the whole arc of
 * the lesson in view instead of only the ending (4.5.0).
 */
function buildTranscript(messages: Message[]): string {
  const line = (m: Message): string =>
    `${m.role === 'user' ? '学习者' : '导师'}: ${m.content}`
  const body = messages.map(line).join('\n\n')

  if (messages.length <= LONG_CLASS_MESSAGES) return body

  const third = Math.ceil(messages.length / 3)
  const section = (msgs: Message[], label: string): string =>
    `【${label}】\n${msgs.map(line).join('\n\n')}`

  return [
    section(messages.slice(0, third), '课堂开头'),
    section(messages.slice(third, third * 2), '课堂中间'),
    section(messages.slice(third * 2), '课堂结尾')
  ].join('\n\n\n')
}

async function generateArtifact(
  client: DeepSeekClient,
  type: ArtifactType,
  transcript: string,
  cardTarget?: string,
  readingNotes?: string
): Promise<ArtifactResult | null> {
  const prompt = buildArtifactPrompt(type, cardTarget)

  const userContent = readingNotes
    ? transcript + '\n\n【教材阅读批注】\n' + readingNotes
    : transcript

  const response = await client.chat([
    { role: 'system', content: prompt },
    { role: 'user', content: userContent }
  ])

  const content = (response.content ?? '').trim()
  if (!content) return null

  return { type, content }
}

function buildArtifactPrompt(type: ArtifactType, cardTarget?: string): string {
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

【课堂事实铁律】
- 严格区分：伙伴"提到过/讲解过" ≠ 伙伴"问过" ≠ 学习者"回答过" ≠ 伙伴"准备以后讲（计划）" ≠ 学习者"已经掌握"。
- 只有学习者确实回答正确、或被确认理解的内容，才能写成"学习者掌握/理解"。
- 如果课堂结尾伙伴刚提出问题、学习者还没来得及回答就下课，总结不得写成"已经完成"或"已经掌握"，要如实写"尚待回答的问题"。
- 不得把计划、预告或伙伴的讲解写成已经发生的学习经历。
- 如果学习者在整个课堂几乎没说话，只写一句陈述事实，不要虚构学习成果。

【整段学习回顾】
- 总结要兼顾课堂的"起点、发展、结尾"三个阶段：开头讨论的重要主题必须保留，不得被后半段内容挤掉。
- 如果对话按【课堂开头/课堂中间/课堂结尾】分段给出，请分别概括每一段的主题，再合并成一份连贯的总结。

用中文回答，控制在 450 字以内。`

    case ArtifactType.Flashcards:
      return `你是一位教育助手。请根据以下苏格拉底式课堂对话，生成 ${cardTarget} 记忆卡片（flashcards）。
每张卡片格式：
- 问题：(一个关键概念问题)
- 答案：(简洁的答案)

【质量要求】
- 只考对话里真正讲过的内容，不考课堂之外的知识。
- 优先选真正值得复习的核心概念与关键推论，避免缺乏学习价值的"数字陷阱"题（如无意义的年份、纯记忆数字）。
- 专业题目的结论如果取决于具体前提（如税法等），题干必须完整保留前提条件，避免题目与答案对不上。
- 不要给学习者编造名字，也不要虚构课堂中不存在的细节。
- 答案与解析（如有）的选项字母/编号必须与题目一致；答案说明直接了当，不绕弯。
- 长课堂可以覆盖讨论过的多个主题生成更多卡片；内容少的课堂宁少勿滥。

用中文回答，使用 Markdown 格式。`

    case ArtifactType.Diary:
      return `你是一位教育助手。请以学习者的第一人称视角，写一篇简短的课后日记（100-150 字）。
日记应反映：
- 今天学到了什么
- 有什么新的认识或感悟
- 还想继续探索的问题

如果用户内容中附有【教材阅读批注】（学习者阅读教材时做的标注），可自然融入其中 1-2 条与之相关的感悟，但不要逐条罗列。

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

【跨学科铁律】
- 薄弱点只写**跨学科通用**的认知特征（如"对抽象公式的直觉理解弱""依赖老师重复讲解"），
  不要写具体学科知识点、公式、章节或题目内容（如"欧拉公式""菲涅耳衍射"）。
- 画像服务于之后所有学科的学习，必须保持学科无关。

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

    case ArtifactType.KnowledgeGraph:
      return `你是一位教育助手。请根据以下课堂对话，用 Mermaid flowchart 语法生成本节课的知识点关系图。
要求：
- 节点 = 本课真实讨论过的核心概念/知识点，标签简短（如 A[一元二次方程]）
- 连线 = 概念间关系（引出/依赖/对比/举例等），用边标签标注，如 A -->|引出| B
- 只使用对话中真正出现过的概念，不补充课外知识
- 图例可加一句说明（用 %% 注释）
输出格式：直接输出一个 mermaid 代码块（\`\`\`mermaid ... \`\`\`），不要其他解释文字。
如果概念太少（少于 3 个），输出一句说明"本节课知识点较少，未生成图谱"。`

    case ArtifactType.LessonAudio:
      return `你是一位教育助手。请把以下课堂对话浓缩成一段 5-7 轮的"双人回顾对话"脚本，用于课后语音回听。
格式（每行一条）：
【导师】<一句话>
【学习者】<一句话>

要求：
- 覆盖本课最核心的 2-4 个概念，先由导师提问唤起记忆，再由学习者用自己的话简述，导师补充修正。
- 学习者的话语要自然口语化、可理解（像真人回忆），不是背诵定义。
- 导师语气与课堂角色一致，鼓励、追问并给出关键结论。
- 每轮对白 15-40 字，总时长控制在 1 分钟左右。
- 只使用课堂真实讨论过的内容，不新增课外知识点。
- 铁律：仅输出【导师】/【学习者】行，不要标题、不要解释、不要其他格式。`

    case ArtifactType.LessonTimeline:
      return `你是一位教育助手。请根据以下课堂对话生成"课堂时间线"，每行一个事件：
格式：
- MM:SS 事件名：一句话描述

要求：
- MM:SS 为相对课堂开始的时间（从 00:00 开始，事件越多时间越靠后）
- 按时间顺序排列 5-8 个事件，事件名简短（如"引入主题""定义概念""举例说明""提问检验"）
- 描述基于课堂真实内容，可包含关键术语
- 铁律：仅输出时间线行，不要标题、不要解释。如果课堂太短（少于 3 条对话），输出一行：本节课太短，未生成时间线。`

    case ArtifactType.LessonFaq:
      return `你是一位教育助手。请根据以下课堂对话，生成本课 FAQ（学习者可能想再确认的问题）。
格式，每个问答两块：
- 问：<一句话问题>
- 答：<2-3 句简洁回答，基于课堂内容>

要求：
- 3-5 个问答，覆盖本课核心概念、容易混淆的点、以及课堂未完全展开但仍重要的问题
- 问题用学习者视角提问
- 铁律：仅输出问答行，不要标题、不要解释。`

    /* v8 ignore next -- @preserve */
    default: {
      /* v8 ignore next -- @preserve */
      const _exhaustive: never = type
      /* v8 ignore next -- @preserve */
      throw new Error(`Unknown artifact type: ${_exhaustive}`)
    }
  }
}

/** 生成薄弱概念卡片的输入：概念 + 课堂证据摘录。 */
export interface ConceptCardSource {
  name: string
  mastery: number
  misconception: string | null
  /** 该概念最近一次课堂的证据消息摘录（已截断，可为空）。 */
  evidence: string[]
}

function buildConceptCardPrompt(): string {
  return `你是一位教育助手。学习者对下列概念掌握薄弱（或存在误解），请据此生成 3-6 张记忆卡片帮助复习。
每张卡片格式：
- 问题：(针对薄弱点或误解点的关键问题)
- 答案：(简洁准确的答案；如概念带误解点，先辨析错误再给正确理解)

【质量要求】
- 只考给定概念与证据里的内容，不引入外部知识、不编造课堂里没有的细节。
- 有误解点的概念优先出「辨析题」；其余考核心含义与用法。
- 问题必须能独立理解，不依赖上下文；答案直接了当。
- 内容不足时宁少勿滥（至少 1 张）。
- 铁律：只输出 问题/答案 卡片行，不要标题、不要解释。

用中文回答，使用 Markdown 格式。`
}

function buildConceptCardInput(concepts: ConceptCardSource[]): string {
  const lines: string[] = ['需要复习的概念：', '']
  concepts.forEach((c, i) => {
    const mis = c.misconception ? `，误解点：${c.misconception}` : ''
    lines.push(`${i + 1}. ${c.name}（掌握度 ${Math.round(c.mastery * 100)}%${mis}）`)
    if (c.evidence.length > 0) {
      lines.push('   课堂证据摘录：')
      for (const quote of c.evidence) lines.push(`   - ${quote}`)
    }
  })
  return lines.join('\n')
}

/**
 * 为薄弱概念生成记忆卡片内容（`- 问题：/- 答案：` 格式）。
 * 返回 null 表示模型没有产出可解析的卡片（调用方据此报错，不写空产物）。
 */
export async function generateConceptCards(
  concepts: ConceptCardSource[],
  config: ArtifactProviderConfig
): Promise<string | null> {
  const endpoint = config.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const adapter = createDeepSeekHttpAdapter({ endpoint })
  const client = new DeepSeekClient(config.apiKey, adapter, config.model)

  const response = await client.chat([
    { role: 'system', content: buildConceptCardPrompt() },
    { role: 'user', content: buildConceptCardInput(concepts) }
  ])

  const content = (response.content ?? '').trim()
  if (!content || parseFlashcards(content).length === 0) return null
  return content
}
