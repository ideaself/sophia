import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { rehypeTexSource } from './mathCopy'
import { MermaidBlock } from '../components/MermaidBlock'
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
  const { components, ...rest } = props
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeTexSource, rehypeKatex, rehypeHighlight]}
      components={{
        code({ className, children, ...codeProps }) {
          const match = /language-(\w+)/.exec(className ?? '')
          if (match?.[1] === 'mermaid') {
            return <MermaidBlock code={String(children).replace(/\n$/, '')} />
          }
          return <code className={className} {...codeProps}>{children}</code>
        },
        ...components
      }}
      {...rest}
    />
  )
}

export default MarkdownRenderer
