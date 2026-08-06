let ready: Promise<typeof import('mermaid')> | null = null

/**
 * Lazily load + initialize mermaid. mermaid + its diagram runtimes are heavy,
 * so they only download when the first ```mermaid block actually renders.
 */
export function loadMermaid(): Promise<typeof import('mermaid')> {
  ready ??= import('mermaid').then((m) => {
    m.default.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose'
    })
    return m
  })
  return ready
}
