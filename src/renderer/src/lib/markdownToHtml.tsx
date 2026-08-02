import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'

/**
 * Render markdown (with math/KaTeX + code highlight) to a static HTML string,
 * reusing the exact same pipeline as the chat bubbles. Used to build the body
 * for PDF export (课堂记录/笔记导出).
 */
export function markdownToHtml(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeHighlight]}
    >
      {markdown}
    </ReactMarkdown>
  )
}
