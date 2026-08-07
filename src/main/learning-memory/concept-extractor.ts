import { DeepSeekClient } from '../llm/deepseek-client'
import { createDeepSeekHttpAdapter } from '../llm/deepseek-http-adapter'
import type { ConceptPerformance, ConceptEvidenceUpdate } from './concept-store'

export interface ConceptExtractorConfig {
  apiKey: string
  baseUrl: string
  model: string
}

const EXTRACT_PROMPT = `你是学习分析助手。分析下面这段课堂对话（学习者与苏格拉底式导师的问答），识别学习者接触到的概念及其掌握表现。

输出 JSON 数组，每项：
{"name": "概念名", "performance": "correct|partial|incorrect|unclear", "misconception": "误解描述或省略"}

规则：
- performance 是【学习者】的表现：
  - correct：学习者正确回答了导师关于该概念的问题，或正确应用了概念
  - partial：部分正确、有犹豫、需要提示后才答出
  - incorrect：答错、概念混淆、错误应用
  - unclear：导师刚讲到/刚提问，学习者还未作答或只回应"好的/嗯"（这类不算 attempt，仅标记）
- misconception 仅在 incorrect 或 partial 时给出，一句话描述学习者的误解
- 只列对话中真实出现的概念，不补充课外知识
- 一节课通常 1-4 个核心概念，宁少勿滥
- 只输出 JSON，不要任何其他文字`

/**
 * 对话中增量识别概念与学习者表现（Kimi 方案）。
 * 输入最近一轮问答，输出结构化概念更新；失败返回 null（非致命）。
 */
export async function extractConceptUpdates(
  transcript: string,
  config: ConceptExtractorConfig
): Promise<ConceptEvidenceUpdate[] | null> {
  const endpoint = config.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const client = new DeepSeekClient(
    config.apiKey,
    createDeepSeekHttpAdapter({ endpoint }),
    config.model
  )

  try {
    const response = await client.chat([
      { role: 'system', content: EXTRACT_PROMPT },
      { role: 'user', content: transcript }
    ])
    if (!response.content) return null
    return parseUpdates(response.content)
  } catch (err) {
    console.warn('[concepts] 概念识别失败（非致命）：', err instanceof Error ? err.message : err)
    return null
  }
}

/** 解析模型输出的 JSON 数组（容错：先直接 parse，失败后提取 [] 片段）。 */
export function parseUpdates(raw: string): ConceptEvidenceUpdate[] | null {
  const text = raw.trim()
  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return null
    return normalize(parsed)
  } catch {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end <= start) return null
    try {
      return normalize(JSON.parse(text.slice(start, end + 1)))
    } catch {
      return null
    }
  }
}

function normalize(parsed: unknown[]): ConceptEvidenceUpdate[] {
  const out: ConceptEvidenceUpdate[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    const perf = typeof o.performance === 'string' ? o.performance : ''
    if (!name || !(['correct', 'partial', 'incorrect', 'unclear'] as ConceptPerformance[]).includes(perf as ConceptPerformance)) {
      continue
    }
    const misconception = typeof o.misconception === 'string' ? o.misconception.trim() : undefined
    out.push({ name, performance: perf as ConceptPerformance, ...(misconception ? { misconception } : {}) })
  }
  return out
}
