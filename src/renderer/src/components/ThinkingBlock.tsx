import { lazy, Suspense } from 'react'
import { normalizeMathDelimiters } from '../../../shared/math-delimiters'

const MarkdownRenderer = lazy(() => import('../lib/MarkdownRenderer'))

/**
 * 模型思考过程（reasoning）渲染 —— 与正文消息同管线：
 * markdown + KaTeX，并归一化 \(...\)/\[...\] 公式定界符。
 */
export function ThinkingBlock({ content }: { content: string }): React.ReactElement | null {
  if (!content.trim()) return null
  return (
    <div className="markdown-body mt-2 text-xs leading-relaxed text-text-secondary">
      <Suspense fallback={null}>
        <MarkdownRenderer>{normalizeMathDelimiters(content)}</MarkdownRenderer>
      </Suspense>
    </div>
  )
}
