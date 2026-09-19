/**
 * verify_grounding 轻量规则校验（里程碑 2）：
 * 不调用 LLM，纯规则复查 —— 知识性提问的回答是否引用了教材出处。
 * 检测到未引用时由 UI 展示轻量提醒（不打扰、不阻断）。
 */

/** 教材出处引用标记：markdown 引用块内的 【教材出处 · 《…》 · …】 */
const CITATION_RE = /【教材出处 · 《[^】]+》/

/** 用户消息是否为知识性提问（可能期待教材依据的回答）。 */
export function isKnowledgeQuestion(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /[?？]$/.test(t) || /什么是|为什么|如何|怎么|解释一下|说明一下|原理|含义|区别|作用|推导/.test(t)
}

/** assistant 回复是否包含教材出处引用。 */
export function hasTextbookCitation(content: string): boolean {
  return CITATION_RE.test(content)
}

export interface CitationBlock {
  /** 引用标记原文（含【教材出处 …】）。 */
  marker: string
  /** 引用块正文。 */
  quoted: string
}

/**
 * 提取回答中的教材引用块（markdown 引用行）。
 * 无引用时返回空数组。
 */
export function extractCitations(content: string): CitationBlock[] {
  const out: CitationBlock[] = []
  const lines = content.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const m = /^\s*>\s*(【教材出处 · 《[^》]+》 · [^】]+】)(?:\s*)$/.exec(line)
    if (m) {
      const marker = m[1]
      const quoted: string[] = []
      let j = i + 1
      while (j < lines.length && /^\s*>\s?/.test(lines[j])) {
        quoted.push(lines[j].replace(/^\s*>\s?/, ''))
        j++
      }
      if (quoted.length > 0) {
        out.push({ marker, quoted: quoted.join('\n') })
      }
      i = j
      continue
    }
    i++
  }
  return out
}

/** 规范化文本用于模糊匹配：去空白与中文标点、小写。 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\u3000、。，；：？！·《》【】"'“”‘’\-—_()（）]/g, '')
}

/**
 * 引用真实性校验（里程碑 5）：引用块正文是否真的能在教材中找到对应内容。
 * 策略：引用正文切为 6 字以上片段，任一长片段可在教材中找到（包含关系）即视为真实。
 */
export function citationMatchesTextbook(citation: CitationBlock, textbook: string): boolean {
  return verifyCitation(citation, textbook) === 'verified'
}

/** 单条引用真实性判定（运行时校验用三态，区别于布尔的历史 API）。 */
export type CitationVerdict =
  /** 存在 ≥6 字片段可在教材中找到。 */
  | 'verified'
  /** 有足够长的片段但都找不到 —— 疑似伪造引用。 */
  | 'mismatch'
  /** 引用过短/为空，无法判定（不标红）。 */
  | 'unverifiable'

/** 在已规范化的教材文本上判定，避免逐条引用重复规范化整本书。 */
export function verifyCitationNormalized(
  citation: CitationBlock,
  normalizedTextbook: string
): CitationVerdict {
  const chunks = citation.quoted
    .split('\n')
    .map(normalizeForMatch)
    .filter((s) => s.length >= 6)
  if (chunks.length === 0) return 'unverifiable'
  return chunks.some((chunk) => normalizedTextbook.includes(chunk)) ? 'verified' : 'mismatch'
}

/** 引用真实性判定（内部先规范化教材全文）。 */
export function verifyCitation(citation: CitationBlock, textbook: string): CitationVerdict {
  return verifyCitationNormalized(citation, normalizeForMatch(textbook))
}
