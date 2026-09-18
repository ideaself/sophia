/**
 * Deterministic cross-chapter textbook retrieval.
 *
 * Inspired by whole-book teaching's "whole-book teaching": when a concept spans
 * chapters, echoes an earlier idea, or calls for checking previous material,
 * the companion should be able to draw on relevant passages from anywhere in
 * the textbook — not just the current reading window.
 *
 * This module finds those passages locally (no extra LLM call):
 *   1. Split the textbook into sections by markdown heading.
 *   2. Extract candidate terms from the recent conversation (CJK bigrams and
 *      trigrams + latin words, minus stopwords and corpus-wide words).
 *   3. Score sections by how many distinct terms they contain.
 *   4. Return the best matching passages, annotated with their chapter heading.
 */

import { estimateTokens } from './token-budget'

export interface TextbookSection {
  heading: string
  text: string
}

export interface RetrievedPassage {
  heading: string
  excerpt: string
}

/** Normalize a heading for fuzzy matching (strip chapter numbering, punctuation). */
export function normalizeHeading(s: string): string {
  return s
    .replace(/第[一二三四五六七八九十百千万零0-9]+[章节部分课篇卷]/g, '')
    .replace(/[：:\s、·—-]/g, '')
    .toLowerCase()
}

/**
 * Fuzzy heading match: exact substring either way, or a shared 4-char n-gram.
 * Used to map AI-cited chapter names back to real textbook sections.
 */
export function headingMatches(target: string, heading: string): boolean {
  const a = normalizeHeading(target)
  const b = normalizeHeading(heading)
  if (!a || !b) return false
  if (a.includes(b) || b.includes(a)) return true
  const grams = new Set<string>()
  for (let i = 0; i <= a.length - 4; i++) grams.add(a.slice(i, i + 4))
  for (let i = 0; i <= b.length - 4; i++) {
    if (grams.has(b.slice(i, i + 4))) return true
  }
  return false
}

export interface RetrievalOptions {
  /** Maximum number of passages to return (default: 3). */
  maxPassages?: number
  /** Maximum excerpt length in characters (default: 320). */
  maxExcerptChars?: number
  /** Drop terms that appear in more than this fraction of sections (default: 0.35). */
  maxTermSectionRatio?: number
}

const HEADING_RE = /^#{1,4}\s+(.+)$/
const LATIN_TOKEN_RE = /[A-Za-z][A-Za-z0-9\-_]{2,}/g

/** Common Chinese function words / filler that carry no retrieval signal. */
const STOPWORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '这', '那', '就', '都', '也',
  '很', '和', '与', '及', '或', '但', '而', '并', '被', '把', '对', '从', '到', '给',
  '让', '会', '能', '要', '想', '说', '问', '学', '习', '一', '不', '有', '没', '上',
  '下', '中', '里', '后', '前', '时', '个', '种', '些', '为', '于', '之', '其', '们',
  '什么', '怎么', '为什么', '这个', '那个', '我们', '你们', '他们', '老师', '同学',
  '教材', '课本', '内容', '问题', '答案', '知道', '觉得', '应该', '可以', '一下',
  '一个', '一种', '时候', '东西', '老师', '咱们', '意思', '明白', '理解'
])

/**
 * Split textbook content into sections by markdown heading.
 * Text before the first heading becomes the preamble section.
 */
export function splitSections(content: string): TextbookSection[] {
  const sections: TextbookSection[] = []
  let currentHeading = '（前言）'
  let currentLines: string[] = []

  const flush = () => {
    const text = currentLines.join('\n').trim()
    if (text) {
      sections.push({ heading: currentHeading, text })
    }
    currentLines = []
  }

  for (const line of content.split('\n')) {
    const m = HEADING_RE.exec(line.trim())
    if (m) {
      flush()
      currentHeading = m[1].trim()
    } else {
      currentLines.push(line)
    }
  }
  flush()

  return sections
}

/** Strip markdown noise before term extraction. */
function cleanText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^[#>\-\d.\s]+/gm, ' ')
    .replace(/\s+/g, ' ')
}

/**
 * Extract candidate search terms from message text:
 * - CJK: all bigrams and trigrams over consecutive CJK runs
 * - Latin: 3+ char word tokens
 * Terms appearing everywhere (high section ratio) are dropped downstream.
 */
export function extractTerms(texts: string[], maxTerms = 24): string[] {
  const counts = new Map<string, number>()
  const add = (term: string) => {
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }

  for (const raw of texts) {
    const text = cleanText(raw)
    for (const token of text.match(LATIN_TOKEN_RE) ?? []) {
      const lower = token.toLowerCase()
      if (lower.length >= 3 && !STOPWORDS.has(lower)) add(lower)
    }

    // Consecutive CJK runs → bigrams & trigrams
    const cjkRuns = text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? []
    for (const run of cjkRuns) {
      if (run.length < 2) continue
      for (let i = 0; i < run.length - 1; i++) {
        const bi = run.slice(i, i + 2)
        if (!STOPWORDS.has(bi)) add(bi)
      }
      for (let i = 0; i < run.length - 2; i++) {
        const tri = run.slice(i, i + 3)
        if (!STOPWORDS.has(tri)) add(tri)
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([term]) => term)
}

/**
 * Score sections by distinct term hits and return the best passages.
 */
export function retrievePassages(
  content: string,
  texts: string[],
  options: RetrievalOptions = {}
): RetrievedPassage[] {
  const {
    maxPassages = 3,
    maxExcerptChars = 320,
    maxTermSectionRatio = 0.35
  } = options

  const sections = splitSections(content)
  if (sections.length === 0) return []

  const terms = extractTerms(texts)
  if (terms.length === 0) return []

  // Corpus-wide terms carry no signal — drop ones found in too many sections.
  const sectionTermSets = sections.map((s) => {
    const set = new Set<string>()
    const lower = s.text.toLowerCase()
    for (const term of terms) {
      if (lower.includes(term)) set.add(term)
    }
    return set
  })
  const usableTerms = terms.filter((term) => {
    const hitCount = sectionTermSets.filter((set) => set.has(term)).length
    return hitCount > 0 && hitCount / sections.length <= maxTermSectionRatio
  })
  if (usableTerms.length === 0) return []

  const scored = sections
    .map((section, idx) => ({
      section,
      idx,
      matched: usableTerms.filter((t) => sectionTermSets[idx].has(t))
    }))
    .filter((entry) => entry.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length || a.idx - b.idx)

  const passages: RetrievedPassage[] = []
  const usedHeadings = new Set<string>()
  for (const entry of scored.slice(0, maxPassages)) {
    // Skip duplicate sections of the same heading (e.g. repeated "练习").
    if (usedHeadings.has(entry.section.heading)) continue
    usedHeadings.add(entry.section.heading)
    passages.push({
      heading: entry.section.heading,
      excerpt: buildExcerpt(entry.section.text, entry.matched, maxExcerptChars)
    })
    if (passages.length >= maxPassages) break
  }

  return passages
}

/**
 * Extract the textbook region around the learner's current position.
 *
 * Sections are ordered; the section at `fraction` (0..1) is included first,
 * followed by later sections until the token budget is used up. With no
 * progress info, teaching starts from the beginning (existing behavior).
 */
export function extractRegionAroundProgress(
  content: string,
  fraction: number | null,
  maxEstTokens = 2200
): string {
  const sections = splitSections(content)
  if (sections.length === 0) return ''

  const startIdx =
    fraction !== null && Number.isFinite(fraction) && fraction > 0
      ? Math.min(sections.length - 1, Math.floor(fraction * sections.length))
      : 0

  const parts: string[] = []
  let used = 0
  for (let i = startIdx; i < sections.length; i++) {
    const block = `## ${sections[i].heading}\n\n${sections[i].text}`
    const cost = estimateTokens(block)
    if (parts.length > 0 && used + cost > maxEstTokens) break
    parts.push(block)
    used += cost
  }
  return parts.join('\n\n')
}

/**
 * Extract the paragraph(s) containing matched terms, truncated to a budget.
 */
function buildExcerpt(text: string, terms: string[], maxChars: number): string {
  const paragraphs = text
    .split(/\n{1,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  const lowerTerms = terms.map((t) => t.toLowerCase())
  const hits = paragraphs
    .map((p, idx) => ({ p, idx, lower: p.toLowerCase() }))
    .filter(({ lower }) => lowerTerms.some((t) => lower.includes(t)))
    .sort((a, b) => a.idx - b.idx)

  if (hits.length === 0) {
    /* v8 ignore next -- @preserve */
    return text.slice(0, maxChars)
  }

  let excerpt = ''
  for (const { p } of hits) {
    if (excerpt.length + p.length + 1 > maxChars) {
      if (!excerpt) excerpt = p.slice(0, maxChars)
      break
    }
    excerpt += (excerpt ? '\n' : '') + p
  }
  return excerpt
}

/**
 * Format retrieved passages as the prompt segment body, with a citation rule.
 */
export function formatPassages(
  passages: RetrievedPassage[],
  textbookTitle?: string
): string {
  const title = textbookTitle ? `《${textbookTitle}》` : '教材'
  const lines: string[] = []
  for (const [i, p] of passages.entries()) {
    lines.push(`【相关教材段落 ${i + 1} · ${title} · ${p.heading}】`)
    lines.push('')
    lines.push(p.excerpt)
    lines.push('')
  }
  lines.push(
    '引用规则：引用上述教材内容时，请用引用块（>）引用原文，并在引用前标注出处，',
    '格式：【教材出处 · ' + title + ' · 章节名】。只引用与讨论真正相关的段落，绝不编造教材没有的内容。'
  )
  return lines.join('\n')
}
