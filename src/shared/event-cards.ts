/**
 * 课堂事件卡片（里程碑 2）：assistant 回复以约定引用块开头时，
 * 渲染为结构化卡片（提示 / 纠错 / 记忆提议），其余内容照常 markdown。
 *
 * 格式约定（由课堂快捷指令 prompt 引导，未命中时静默回退普通气泡）：
 *   > 💡 提示：…
 *   > ⚠️ 纠正：…
 *   > 🧠 建议记忆：<问题> - <答案>
 */

export type EventCardKind = 'hint' | 'correction' | 'memory'

export interface EventCard {
  kind: EventCardKind
  body: string
  /** 卡片块之后的普通内容（可能为空）。 */
  rest: string
}

const KIND_PREFIXES: Array<{ kind: EventCardKind; re: RegExp }> = [
  { kind: 'hint', re: /^>\s*💡\s*提示\s*[:：]\s*(.*)$/ },
  { kind: 'correction', re: /^>\s*⚠️\s*纠正\s*[:：]\s*(.*)$/ },
  { kind: 'memory', re: /^>\s*🧠\s*建议记忆\s*[:：]\s*(.*)$/ }
]

/** 解析事件卡片；内容不是事件卡片时返回 null。 */
export function parseEventCard(content: string): EventCard | null {
  const lines = content.split('\n')
  let first = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      first = i
      break
    }
  }
  if (first < 0) return null

  const hit = KIND_PREFIXES.find(({ re }) => re.test(lines[first]))
  if (!hit) return null

  const bodyParts: string[] = []
  const m = hit.re.exec(lines[first])
  if (m && m[1].trim()) bodyParts.push(m[1].trim())

  let cursor = first + 1
  while (cursor < lines.length && lines[cursor].trim().startsWith('>')) {
    const text = lines[cursor].replace(/^\s*>\s?/, '').trim()
    if (text) bodyParts.push(text)
    cursor++
  }
  if (bodyParts.length === 0) return null

  const restLines = lines.slice(cursor)
  while (restLines.length && !restLines[0].trim()) restLines.shift()
  while (restLines.length && !restLines[restLines.length - 1].trim()) restLines.pop()

  return { kind: hit.kind, body: bodyParts.join('\n'), rest: restLines.join('\n') }
}
