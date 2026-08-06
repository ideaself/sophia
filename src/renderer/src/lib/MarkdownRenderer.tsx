import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { rehypeTexSource } from './mathCopy'
import 'katex/dist/katex.min.css'

/**
 * Shared markdown pipeline (GFM + KaTeX + code highlight + TeX source
 * tracking for 划取复制). This module is the code-split entry point for the
 * heavy markdown vendor stack — load it via React.lazy so it only downloads
 * once a message/artifact actually needs rendering. KaTeX CSS + fonts are
 * bundled here as well (importing them in main.css produced unreferenced
 * font warnings and missing font files in the production build).
 */
export function MarkdownRenderer(props: React.ComponentProps<typeof ReactMarkdown>): React.ReactElement {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeTexSource, rehypeKatex, rehypeHighlight]}
      {...props}
    />
  )
}

export default MarkdownRenderer
