import { useEffect, useRef, useState } from 'react'
import { loadMermaid } from '../lib/mermaid'

/** 渲染 ```mermaid 代码块（mermaid 库按需加载）。 */
export function MermaidBlock({ code }: { code: string }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useRef(`mermaid-${Math.random().toString(36).slice(2, 10)}`)

  useEffect(() => {
    /* v8 ignore next -- @preserve */
    if (!ref.current) return
    let cancelled = false
    loadMermaid()
      .then((m) => m.default.render(id.current, code))
      .then(({ svg }) => {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [code])

  if (error) {
    return <pre className="overflow-auto text-xs text-red-400"><code>{code}</code></pre>
  }
  return <div ref={ref} className="my-2 flex justify-center" />
}
