/**
 * Search-mark rendering for the EPUB reader.
 *
 * Marks are produced as part of the controlled HTML pipeline (notes applied
 * first, then search) instead of mutating the live DOM after paint: React
 * writes the final markup once, so a re-render can never clobber the marks
 * and there is no second mutation pass to keep in sync.
 *
 * The walk is text-node-only, so query text inside attributes (class names,
 * data-note ids) never matches. Text already inside a note `<mark>` is
 * skipped — the same rule the previous live-DOM implementation used.
 */

export interface SearchMarkResult {
  html: string
  /** Matches wrapped in this chapter (drives the "本页 x/y" counter). */
  count: number
}

export function applySearchMarksToHtml(html: string, query: string): SearchMarkResult {
  const q = query.trim().toLowerCase()
  if (!q || !html) return { html, count: 0 }

  const host = document.createElement('div')
  host.innerHTML = html

  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) {
    const n = walker.currentNode as Text
    if (n.parentElement && !n.parentElement.closest('mark')) textNodes.push(n)
  }

  let count = 0
  for (const node of textNodes) {
    /* v8 ignore next -- @preserve */
    const raw = node.nodeValue ?? ''
    const lower = raw.toLowerCase()
    if (!lower.includes(q)) continue
    const frag = document.createDocumentFragment()
    let last = 0
    let idx = lower.indexOf(q)
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(raw.slice(last, idx)))
      const mark = document.createElement('mark')
      mark.setAttribute('data-search', '1')
      mark.textContent = raw.slice(idx, idx + q.length)
      frag.appendChild(mark)
      count += 1
      last = idx + q.length
      idx = lower.indexOf(q, last)
    }
    if (last < raw.length) frag.appendChild(document.createTextNode(raw.slice(last)))
    node.parentNode?.replaceChild(frag, node)
  }

  return { html: host.innerHTML, count }
}
