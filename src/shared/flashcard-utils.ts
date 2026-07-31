/**
 * Shared flashcard helpers (parsing, artifact rebuild, Anki export).
 * Framework-free so they can be unit-tested from the node side.
 */

export interface ParsedCard {
  question: string
  answer: string
}

export interface AnkiCardLike {
  question: string
  answer: string
  conversationTitle: string
  createdAt?: string
}

/**
 * Parse a flashcards artifact body into cards.
 * Supported format (one card per 问题/答案 pair):
 *   - 问题：...
 *   - 答案：...
 *   Continuation lines are appended to the current field.
 */
export function parseFlashcards(content: string): ParsedCard[] {
  const cards: ParsedCard[] = []
  const lines = content.split('\n')
  let currentQ = ''
  let currentA = ''
  let inQ = false
  let inA = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.match(/^[-*]\s*问题[：:]\s*(.+)/)) {
      if (currentQ && currentA) {
        cards.push({ question: currentQ, answer: currentA })
      }
      currentQ = trimmed.replace(/^[-*]\s*问题[：:]\s*/, '')
      currentA = ''
      inQ = true
      inA = false
    } else if (trimmed.match(/^[-*]\s*答案[：:]\s*(.+)/)) {
      currentA = trimmed.replace(/^[-*]\s*答案[：:]\s*/, '')
      inQ = false
      inA = true
    } else if (inQ && trimmed) {
      currentQ += '\n' + trimmed
    } else if (inA && trimmed) {
      currentA += '\n' + trimmed
    }
  }
  if (currentQ && currentA) {
    cards.push({ question: currentQ, answer: currentA })
  }
  return cards
}

/** Rebuild artifact content from parsed cards (standard 问题/答案 format). */
export function rebuildArtifactContent(cards: ParsedCard[]): string {
  const lines: string[] = []
  for (const card of cards) {
    const qLines = card.question.split('\n')
    const aLines = card.answer.split('\n')
    lines.push(`- 问题：${qLines[0]}`)
    for (const l of qLines.slice(1)) lines.push(`  ${l}`)
    lines.push(`- 答案：${aLines[0]}`)
    for (const l of aLines.slice(1)) lines.push(`  ${l}`)
    lines.push('')
  }
  return lines.join('\n').trim() + '\n'
}

/** Sanitize text for Anki plain-text import (tabs/newlines are structural). */
export function toAnkiText(text: string): string {
  return text.replace(/\r?\n/g, '<br>').replace(/\t/g, ' ')
}

/** Sanitize a deck name (Anki uses :: for subdecks). */
export function sanitizeDeck(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60)
}

/**
 * Build an Anki plain-text import file.
 * Format: question <TAB> answer <TAB> deck <TAB> tags, tagged by month.
 */
export function buildAnkiImport(cards: AnkiCardLike[]): string {
  const lines = [
    '#separator:tab',
    '#html:true',
    '#deck column:3',
    '#tags column:4'
  ]
  for (const card of cards) {
    const month = (card.createdAt || new Date().toISOString()).slice(0, 7)
    lines.push(
      `${toAnkiText(card.question)}\t${toAnkiText(card.answer)}\t` +
      `Sophia::${sanitizeDeck(card.conversationTitle)}\t` +
      `sophia ${month}`
    )
  }
  return lines.join('\n')
}
