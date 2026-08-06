/**
 * 深度思考（thinking）模式：on / off / auto。
 * auto 按消息特征自动决定——简单问题快速开口，需要多步分析才深入思考
 * （对应官方 4.6「思考深度可以交给自动」）。
 */

export type ThinkingMode = 'on' | 'off' | 'auto'

const AUTO_THINKING_KEYWORDS = [
  '证明', '推导', '论证', '分析', '设计', '求解', '规划',
  '为什么', '原理', '区别', '比较', '归纳', '抽象', '解释一下'
]

export function loadThinkingMode(): ThinkingMode {
  const v = localStorage.getItem('sophia.thinkingEnabled')
  if (v === '1') return 'on'
  if (v === '0') return 'off'
  return 'auto'
}

/** 保存（'1'=开启 '0'=关闭 其他=自动）。 */
export function saveThinkingMode(mode: ThinkingMode): void {
  localStorage.setItem('sophia.thinkingEnabled', mode === 'on' ? '1' : mode === 'off' ? '0' : 'auto')
}

/** auto 模式下的启发式判断。 */
export function shouldUseThinking(message: string, mode: ThinkingMode): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  const text = message.trim()
  if (text.length >= 80) return true
  return AUTO_THINKING_KEYWORDS.some((k) => text.includes(k))
}
