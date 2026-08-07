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
