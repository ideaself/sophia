/**
 * 多形态课堂产物解析（里程碑 4，NotebookLM 类）：
 * 音频回顾脚本 / 课堂时间线 / 课堂 FAQ 的纯解析函数。
 * LLM 产物为约定行格式，解析失败时 UI 回退原文展示。
 */

// ---------------------------------------------------------------------------
// 音频回顾脚本：每行 【导师】/【学习者】 + 内容
// ---------------------------------------------------------------------------

export interface AudioLine {
  speaker: '导师' | '学习者'
  text: string
}

const AUDIO_LINE_RE = /^【(导师|学习者)】\s*(.+)$/

export function parseAudioScript(content: string): AudioLine[] {
  const lines: AudioLine[] = []
  for (const raw of content.split('\n')) {
    const m = AUDIO_LINE_RE.exec(raw.trim())
    if (m && m[2].trim()) {
      lines.push({ speaker: m[1] as AudioLine['speaker'], text: m[2].trim() })
    }
  }
  return lines
}

// ---------------------------------------------------------------------------
// 课堂时间线：每行 `- MM:SS 事件名：描述`
// ---------------------------------------------------------------------------

export interface TimelineEvent {
  time: string
  name: string
  description: string
}

const TIMELINE_RE = /^[-*]\s*(\d{1,2}:\d{2})\s+([^：:]+)[：:]\s*(.+)$/

export function parseTimeline(content: string): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const raw of content.split('\n')) {
    const m = TIMELINE_RE.exec(raw.trim())
    if (m) events.push({ time: m[1], name: m[2].trim(), description: m[3].trim() })
  }
  return events
}

// ---------------------------------------------------------------------------
// 课堂 FAQ：成对的 `- 问：…` / `- 答：…`
// ---------------------------------------------------------------------------

export interface FaqEntry {
  question: string
  answer: string
}

const FAQ_Q_RE = /^[-*]\s*问[：:]\s*(.+)$/
const FAQ_A_RE = /^[-*]\s*答[：:]\s*(.+)$/

export function parseFaq(content: string): FaqEntry[] {
  const entries: FaqEntry[] = []
  let current: { question: string; answer: string } | null = null

  const push = () => {
    if (current && current.question && current.answer) {
      entries.push(current)
      current = null
    }
  }

  for (const raw of content.split('\n')) {
    const line = raw.trim()
    const q = FAQ_Q_RE.exec(line)
    if (q) {
      push()
      current = { question: q[1].trim(), answer: '' }
      continue
    }
    const a = FAQ_A_RE.exec(line)
    if (a && current) {
      current.answer = a[1].trim()
    }
  }
  push()
  return entries
}
