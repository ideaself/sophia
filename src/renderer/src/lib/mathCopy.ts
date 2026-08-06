/**
 * Copying rendered KaTeX math restores the LaTeX source (`$...$` /
 * `$$...$$`) instead of the flattened visual text, so the source can be
 * pasted back into the input box and sent to the LLM without corruption.
 */

/**
 * rehype plugin — remember the raw TeX source of each math element so
 * that selecting + copying a rendered formula can restore the `$...$`
 * source (mirrors the original 1.0.9 "划取复制公式").
 * Must run before rehype-katex (which replaces the raw text with KaTeX HTML).
 */
export function rehypeTexSource() {
  return (tree: unknown): void => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const el = node as { type?: string; tagName?: string; properties?: Record<string, unknown>; children?: unknown[] }
      if (el.type === 'element' && el.properties) {
        const cls = Array.isArray(el.properties.className)
          ? (el.properties.className as string[])
          : []
        if (cls.includes('math')) {
          const raw = (el.children ?? [])
            .map((c) => (c && typeof c === 'object' && 'value' in c ? String((c as { value: unknown }).value) : ''))
            .join('')
          el.properties.dataTex = raw
        }
      }
      if (el.children) el.children.forEach(walk)
    }
    walk(tree)
  }
}

/**
 * Clipboard handler for a markdown-rendered block: when the copied
 * selection contains rendered math, write the `$...$` / `$$...$$` source
 * instead of the browser's flattened text.
 *
 * Handles partial selections inside a single formula: if both endpoints
 * live under the same `[data-tex]` ancestor, the cloned fragment does not
 * include that element, so the whole formula's source is copied instead.
 */
export function handleCopyMathSource(e: React.ClipboardEvent): void {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)

  const fragment = range.cloneContents()
  const mathEls = fragment.querySelectorAll('[data-tex]')

  if (mathEls.length === 0) {
    const start = closestDataTex(range.startContainer)
    const end = closestDataTex(range.endContainer)
    if (start && start === end) {
      e.preventDefault()
      void navigator.clipboard.writeText(texSource(start))
    }
    return
  }

  mathEls.forEach((el) => {
    el.replaceWith(document.createTextNode(texSource(el as HTMLElement)))
  })

  e.preventDefault()
  void navigator.clipboard.writeText(fragment.textContent ?? '')
}

function closestDataTex(node: Node | null): HTMLElement | null {
  if (!node) return null
  const el = node.nodeType === Node.ELEMENT_NODE
    ? (node as HTMLElement)
    : (node.parentElement as HTMLElement | null)
  return el?.closest?.('[data-tex]') ?? null
}

function texSource(el: HTMLElement): string {
  const tex = el.getAttribute('data-tex') ?? ''
  const isDisplay = el.classList.contains('math-display')
  return isDisplay ? `$$\n${tex}\n$$` : `$${tex}$`
}
