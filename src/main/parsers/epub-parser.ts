export interface ParseResult {
  content: string
  totalPages: number
}

export interface EpubChapter {
  id: string
  title: string
  html: string
}

export interface EpubChaptersResult {
  chapters: EpubChapter[]
  title: string
  author: string
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_m: string, code: string) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_m: string, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractEpubText(filePath: string): Promise<ParseResult> {
  const { EPub } = await import('epub')

  const epub = new EPub(filePath)
  await epub.parse()

  const lines: string[] = []

  if (epub.metadata?.title) {
    lines.push(`# ${epub.metadata.title}`)
  }
  if (epub.metadata?.creator) {
    lines.push(`Author: ${epub.metadata.creator}`)
  }
  if (lines.length > 0) {
    lines.push('')
  }

  for (const chapter of epub.flow) {
    try {
      const html = await epub.getChapter(chapter.id)
      const text = htmlToText(html)
      if (text) {
        lines.push(text)
        lines.push('')
      }
    } catch {
      // skip non-text chapters (images, etc.)
    }
  }

  const content = lines.join('\n')
  return { content, totalPages: epub.flow.length }
}

export async function getEpubChapters(filePath: string): Promise<EpubChaptersResult> {
  const { EPub } = await import('epub')

  const epub = new EPub(filePath)
  await epub.parse()

  const chapters: EpubChapter[] = []

  // Preferred path: iterate spine (reading order). But the upstream `epub`
  // library's getChapter() rejects anything whose manifest media-type isn't
  // application/xhtml+xml / image/svg+xml — many older EPUBs use text/html
  // or leave the media-type off entirely. When that happens we fall back
  // to reading the file's raw bytes directly via readFile(href).
  const seenHrefs = new Set<string>()
  for (const chapter of epub.flow) {
    let html: string | null = null
    try {
      html = await epub.getChapter(chapter.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Re-read the raw file — bypasses the mime-type gate but keeps working
      // for any well-formed XHTML/HTML the spine actually points at.
      try {
        const href = (chapter as { href?: string }).href
        if (href) {
          const raw = await epub.readFile(href, 'utf-8')
          html = typeof raw === 'string' ? raw : (raw as Buffer).toString('utf-8')
        } else {
          console.warn(`[epub-parser] Chapter ${chapter.id} has no href to fall back to (${msg})`)
        }
      } catch (fallbackErr) {
        console.warn(`[epub-parser] Failed to load chapter ${chapter.id}: ${msg}; raw-read fallback also failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`)
      }
    }
    if (html) {
      const href = (chapter as { href?: string }).href
      if (href) seenHrefs.add(href)
      chapters.push({
        id: chapter.id,
        title: typeof chapter.title === 'string' && chapter.title ? chapter.title : `Chapter ${chapter.index}`,
        html: extractBodyHtml(html)
      })
    }
  }

  // Fallback: if the spine gave us nothing (empty spine, all bad mime types,
  // or a malformed OPF), scan the manifest for anything that looks like
  // HTML/XHTML and use that.
  if (chapters.length === 0) {
    console.warn('[epub-parser] Spine yielded no chapters; falling back to manifest scan')
    const manifest = (epub as unknown as { manifest: Record<string, { id: string; href?: string; 'media-type'?: string }> }).manifest ?? {}
    const htmlLike = Object.values(manifest).filter((item) => {
      const mime = (item['media-type'] ?? '').toLowerCase()
      const href = (item.href ?? '').toLowerCase()
      return (
        mime === 'application/xhtml+xml' ||
        mime === 'text/html' ||
        mime === 'application/x-dtbook+xml' ||
        (!mime && (href.endsWith('.xhtml') || href.endsWith('.html') || href.endsWith('.htm')))
      )
    })
    let idx = 0
    for (const item of htmlLike) {
      if (!item.href || seenHrefs.has(item.href)) continue
      try {
        const raw = await epub.readFile(item.href, 'utf-8')
        const html = typeof raw === 'string' ? raw : (raw as Buffer).toString('utf-8')
        chapters.push({
          id: item.id,
          title: `第 ${++idx} 节`,
          html: extractBodyHtml(html)
        })
      } catch (err) {
        console.warn(`[epub-parser] Manifest scan: failed to read ${item.href}:`, err instanceof Error ? err.message : String(err))
      }
    }
  }

  if (chapters.length === 0) {
    console.warn(`[epub-parser] Book has no readable chapters. spine.length=${epub.flow.length}, manifest.keys=${Object.keys((epub as unknown as { manifest: Record<string, unknown> }).manifest ?? {}).length}`)
  }

  return {
    chapters,
    title: epub.metadata?.title ?? '',
    author: epub.metadata?.creator ?? ''
  }
}

/**
 * Return the inner HTML of the <body> when present, otherwise the input as-is.
 * Chapters that came in via getChapter() are already body-only; chapters that
 * came in via the raw-file fallback still have full <html>...<body>...</body>
 * wrapping which would render as blank when injected into a div.
 */
function extractBodyHtml(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body\s*>/i)
  if (match) return match[1].trim()
  // No body tag — assume the file is already a fragment (or something weird
  // enough that we should show it anyway rather than nothing).
  return html.trim()
}
