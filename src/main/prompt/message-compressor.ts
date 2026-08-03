import { DeepSeekClient } from '../llm/deepseek-client'
import { createDeepSeekHttpAdapter } from '../llm/deepseek-http-adapter'
import type { DeepSeekChatMessage } from '../llm/types'
import { estimateTokens } from './token-budget'

const SUMMARY_PROMPT = `你是一位教育助手。请将以下课堂对话的早期部分压缩为一段简洁的摘要（100-150 字），保留：
- 已讨论的核心主题
- 学习者展现的理解水平
- 仍然开放的问题

只返回摘要内容，不要附加说明。`

export async function compressMessages(
  messages: DeepSeekChatMessage[],
  config: { apiKey: string; baseUrl: string; model: string }
): Promise<string> {
  const endpoint = config.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const adapter = createDeepSeekHttpAdapter({ endpoint })
  const client = new DeepSeekClient(config.apiKey, adapter, config.model)

  const transcript = messages
    .map((m) => `${m.role === 'user' ? '学习者' : '导师'}: ${m.content}`)
    .join('\n\n')

  const response = await client.chat([
    { role: 'system', content: SUMMARY_PROMPT },
    { role: 'user', content: transcript }
  ])

  return response.content?.trim() ?? ''
}

export function shouldCompress(messages: DeepSeekChatMessage[]): boolean {
  const nonSystem = messages.filter((m) => m.role !== 'system')
  return nonSystem.length >= 150
}

export function splitCompressionWindow(
  messages: DeepSeekChatMessage[]
): { toCompress: DeepSeekChatMessage[]; toKeep: DeepSeekChatMessage[] } {
  const systemMsgs = messages.filter((m) => m.role === 'system')
  const nonSystem = messages.filter((m) => m.role !== 'system')
  const splitIndex = Math.min(Math.floor(nonSystem.length * 0.5), 80)
  const toCompress = nonSystem.slice(0, splitIndex)
  const toKeep = nonSystem.slice(splitIndex)
  return {
    toCompress: [...systemMsgs, ...toCompress],
    toKeep
  }
}

/**
 * Token-budget-aware split: keep the newest messages within `keepTokens`,
 * compress everything older. This is what keeps long classrooms coherent —
 * the old message-count trigger (150) fired far too late, while the 3000-token
 * window silently dropped early context without any summary.
 */
export function splitCompressionWindowByTokens(
  messages: DeepSeekChatMessage[],
  keepTokens: number
): { toCompress: DeepSeekChatMessage[]; toKeep: DeepSeekChatMessage[] } {
  const systemMsgs = messages.filter((m) => m.role === 'system')
  const nonSystem = messages.filter((m) => m.role !== 'system')

  let budget = 0
  let split = nonSystem.length
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const cost = estimateTokens(nonSystem[i].content)
    if (budget + cost > keepTokens) {
      split = i + 1
      break
    }
    budget += cost
    if (budget >= keepTokens) {
      split = i
      break
    }
  }
  // 两端各至少保留一条：toCompress 至少一条（否则无需压缩），
  // toKeep 至少一条（否则摘要+空白对话）。
  const compressCount = Math.min(Math.max(split, 1), nonSystem.length - 1)
  const toCompress = nonSystem.slice(0, compressCount)
  const toKeep = nonSystem.slice(compressCount)
  return {
    toCompress: [...systemMsgs, ...toCompress],
    toKeep
  }
}
