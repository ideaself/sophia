/**
 * 当前课堂标签页的概念掌握度（实时学情面板数据源）：
 * 首次加载 + 订阅 `concepts:updated`（主进程在每轮问答后异步识别概念），
 * 事件按会话过滤后重新拉取。
 */
import { useEffect, useState } from 'react'

export function useConversationConcepts(conversationId: string | null): ConceptStateDTO[] {
  const [concepts, setConcepts] = useState<ConceptStateDTO[]>([])

  useEffect(() => {
    if (!conversationId) {
      setConcepts([])
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const list = await window.sophia.data.listConcepts(conversationId)
        if (!cancelled) setConcepts(list)
      } catch {
        if (!cancelled) setConcepts([])
      }
    }
    void load()
    const off = window.sophia.data.onConceptsUpdated(({ conversationId: updated }) => {
      if (updated === conversationId) void load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [conversationId])

  return concepts
}
