import { DeepSeekClient } from '../llm/deepseek-client'
import { createDeepSeekHttpAdapter } from '../llm/deepseek-http-adapter'
import type { DeepSeekChatMessage } from '../llm/types'

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
