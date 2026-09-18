/**
 * Heuristic PDF front-matter detection (mirrors the original's 1.0.9
 * "PDF 导入更准（跳过目录与序言）").
 *
 * Unpdf's merged text starts at page 1, which is usually the title page,
 * copyright page, table of contents or preface — all of which distort the
 * "starting page" judgment and the semantics of flashcard generation.
 * This helper finds the index of the first page that looks like real body
 * content, so importers can skip the front matter.
 */

const FRONT_HEADING_SIGNALS: RegExp[] = [
  /\bTABLE\s+OF\s+CONTENTS\b/i,
  /\bCONTENTS\b/i,
  /目\s*录/,
  /\bCOPYRIGHT\b/i,
  /版\s*权/i,
  /\bALL\s+RIGHTS\s+RESERVED\b/i,
  /\bPREFACE\b/i,
  /序\s*言/,
  /前\s*言/,
  /\bACKNOWLEDG/i,
  /致\s*谢/i,
  /\bPUBLISHED\s+BY\b/i,
  /出\s*版\s*社/i
]

/** A real chapter start heading (chapter N / 第X章 / numbered section). */
const CHAPTER_HEADING: RegExp = /^(\s*)(第\s*[一二三四五六七八九十百0-9]+\s*[章节部篇]|chapter\s+[0-9ivxlcdm]+|chapter\s+[一二三四五六七八九十]|[0-9]+\s*\.[0-9]+|part\s+[0-9ivxlcdm]+)/im

function proseRatio(text: string): number {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  /* v8 ignore next -- @preserve */
  if (lines.length === 0) return 0
  let prose = 0
  for (const line of lines) {
    // Prose line: reasonably long and ends with sentence punctuation, or
    // contains an embedded clause delimiter.
    if (line.length >= 30 && /[。．.!?！？；;]$/.test(line)) prose++
    else if (line.length >= 40 && /[，,、：:；;]/.test(line)) prose++
  }
  return prose / lines.length
}

function hasFrontSignal(text: string): boolean {
  return FRONT_HEADING_SIGNALS.some((re) => re.test(text))
}

/** Is this page "sparse" — a title/copyright/TOC-style page with little prose? */
function isSparsePage(text: string): boolean {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length <= 2) return true
  // Roman-numeral page numbers are a strong front-matter hint.
  if (/\b(?:I{1,3}|IV|V|VI{0,3}|IX|X|XI{0,3}|XIV|XV)\b/.test(text) && text.trim().length < 1200) {
    /* v8 ignore next -- @preserve */
    return true
  }
  return proseRatio(text) < 0.25
}

/**
 * Return the index of the first page that should be treated as body content.
 * Skips pages that clearly belong to front matter (title/copyright/TOC/
 * preface/acknowledgements) or are too sparse to be a real teaching page.
 * A hard cap prevents over-skipping on books without a clear body.
 */
export function findBodyStartPage(pages: string[]): number {
  if (pages.length === 0) return 0
  // Scan at most the first ~20% (min 6 pages) — enough to find the body of
  // ordinary books without ever over-skipping a short or front-matter-less one.
  const cap = Math.min(pages.length, Math.max(6, Math.floor(pages.length * 0.2)))

  for (let i = 0; i < cap; i++) {
    const text = pages[i]
    if (text.trim().length === 0) continue

    // A page with a chapter heading is body content, even if it also
    // mentions TOC-ish words.
    if (CHAPTER_HEADING.test(text) && proseRatio(text) >= 0.2) return i

    if (hasFrontSignal(text)) continue
    if (isSparsePage(text)) continue

    // Otherwise treat this page as the body start.
    return i
  }
  return 0
}
