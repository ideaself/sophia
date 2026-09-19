/**
 * 运行时引用真实性校验：载入当前课堂绑定教材的正文，对已落盘消息中的
 * 教材引用块逐条判定（`verifyCitationNormalized`），返回「消息 → 未在教材中
 * 找到的引用标记」映射，供消息列表把可疑引用标红。
 *
 * 只审计已落盘消息（流式中的内容在落盘后进入下一轮审计）；教材缺失、
 * 读取失败或正文为空时不做任何标记（宁可不标，避免误伤）。
 */
import { useEffect, useMemo, useState } from 'react'
import { extractCitations, normalizeForMatch, verifyCitationNormalized } from '../../../shared/grounding'

interface AuditableMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type CitationMismatchMap = ReadonlyMap<string, ReadonlySet<string>>

export function useCitationAudit(
  textbookId: string | null,
  messages: ReadonlyArray<AuditableMessage>
): CitationMismatchMap {
  const [normalizedBook, setNormalizedBook] = useState<string | null>(null)

  useEffect(() => {
    if (!textbookId) {
      setNormalizedBook(null)
      return
    }
    let cancelled = false
    window.sophia.data
      .getTextbook(textbookId)
      .then((tb) => {
        if (cancelled) return
        const content = tb?.content ?? ''
        setNormalizedBook(content ? normalizeForMatch(content) : null)
      })
      .catch(() => {
        if (!cancelled) setNormalizedBook(null)
      })
    return () => {
      cancelled = true
    }
  }, [textbookId])

  return useMemo(() => {
    const flagged = new Map<string, Set<string>>()
    if (!normalizedBook) return flagged
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue
      const citations = extractCitations(msg.content)
      if (citations.length === 0) continue
      const mismatched = citations
        .filter((c) => verifyCitationNormalized(c, normalizedBook) === 'mismatch')
        .map((c) => c.marker)
      if (mismatched.length > 0) flagged.set(msg.id, new Set(mismatched))
    }
    return flagged
  }, [normalizedBook, messages])
}
