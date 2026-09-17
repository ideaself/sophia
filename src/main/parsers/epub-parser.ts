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

/**
 * Flatten parsed chapters into plain text (title + author header, then each
 * chapter's body text) — used to rebuild a textbook's content from its
 * original EPUB when the initial import produced no body text.
 */
export function epubChaptersToText(result: EpubChaptersResult): string {
  const lines: string[] = []
  if (result.title) lines.push(`# ${result.title}`)
  if (result.author) lines.push(`Author: ${result.author}`)
  if (lines.length > 0) lines.push('')
  for (const chapter of result.chapters) {
    const text = htmlToText(extractBodyHtml(chapter.html))
    if (text) {
      lines.push(text)
      lines.push('')
    }
  }
  return lines.join('\n')
}

interface FlowChapter {
  id: string
  href?: string
  title?: string
  index?: number
}

/**
 * Load a chapter's HTML with a raw-file fallback.
 *
 * The upstream `epub` library's getChapter() rejects anything whose manifest
 * media-type isn't application/xhtml+xml / image/svg+xml — many older EPUBs
 * use text/html or leave the media-type off entirely. When that happens we
 * fall back to reading the file's raw bytes directly via readFile(href).
 */
async function loadChapterHtml(
  epub: { getChapter: (id: string) => Promise<string>; readFile: (name: string, encoding?: BufferEncoding | undefined) => Promise<string | Buffer> },
  chapter: FlowChapter
): Promise<string | null> {
  try {
    return await epub.getChapter(chapter.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try {
      if (chapter.href) {
        const raw = await epub.readFile(chapter.href, 'utf-8')
        return typeof raw === 'string' ? raw : (raw as Buffer).toString('utf-8')
      }
      console.warn(`[epub-parser] Chapter ${chapter.id} has no href to fall back to (${msg})`)
    } catch (fallbackErr) {
      console.warn(`[epub-parser] Failed to load chapter ${chapter.id}: ${msg}; raw-read fallback also failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`)
    }
  }
  return null
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

  for (const chapter of epub.flow as FlowChapter[]) {
    try {
      const html = await loadChapterHtml(epub, chapter)
      if (!html) continue
      // Raw-file fallback returns the full document — strip <head>/<style>/
      // <script> wrappers so only body text survives the tag-stripping below.
      const body = extractBodyHtml(html)
      const text = htmlToText(body)
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

  // Preferred path: iterate spine (reading order). getChapter() rejects
  // certain media-types, so loadChapterHtml falls back to raw file reads.
  const seenHrefs = new Set<string>()
  for (const chapter of epub.flow as FlowChapter[]) {
    const chapterHref = chapter.href
    const html = await loadChapterHtml(epub, chapter)
    if (html) {
      if (chapterHref) seenHrefs.add(chapterHref)
      const bodyHtml = extractBodyHtml(html)
      const withImages = await inlineImages(bodyHtml, chapterHref, epub)
      chapters.push({
        id: chapter.id,
        title: typeof chapter.title === 'string' && chapter.title ? chapter.title : `Chapter ${chapter.index}`,
        html: withImages
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
        const bodyHtml = extractBodyHtml(html)
        const withImages = await inlineImages(bodyHtml, item.href, epub)
        chapters.push({
          id: item.id,
          title: `第 ${++idx} 节`,
          html: withImages
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

/**
 * Inline every `<img src=...>` and SVG `<image href=...>` as a base64 data
 * URI. Two src shapes need to be resolved:
 *
 *   1. The upstream `epub` package's getChapter() rewrites images to
 *      `${imageroot}${manifestId}/${originalZipPath}` — default imageroot is
 *      `/images/`. We detect that prefix and look up the manifest by id.
 *   2. Our own raw-file fallback preserves the original relative src (e.g.
 *      `../Images/cover.jpg`). Those are resolved against the chapter's
 *      directory inside the ZIP.
 *
 * Any image we can't resolve is left with its original src, which will render
 * as a broken image — the reader still shows all the text around it.
 */
async function inlineImages(
  html: string,
  chapterHref: string | undefined,
  epub: unknown
): Promise<string> {
  const anyEpub = epub as {
    imageroot: string
    manifest: Record<string, { id: string; href?: string; 'media-type'?: string }>
    readFile: (name: string, encoding?: string) => Promise<Buffer | string>
  }
  const imageroot = anyEpub.imageroot // e.g. "/images/"
  const manifest = anyEpub.manifest ?? {}
  const chapterDir = chapterHref ? posixDirname(chapterHref) : ''

  // Cache: same image reused across a chapter (very common for icons) should
  // only be read + base64'd once. Stores the in-flight promise so repeated
  // srcs launched in the same batch share one read instead of racing misses.
  const cache = new Map<string, Promise<string | null>>()

  function toDataUri(zipPath: string, hintedMime?: string): Promise<string | null> {
    const cached = cache.get(zipPath)
    if (cached) return cached
    const task = (async (): Promise<string | null> => {
      try {
        const buf = (await anyEpub.readFile(zipPath)) as Buffer
        const mime = hintedMime || mimeFromExt(zipPath) || 'application/octet-stream'
        return `data:${mime};base64,${buf.toString('base64')}`
      } catch (err) {
        console.warn(`[epub-parser] Failed to inline image ${zipPath}:`, err instanceof Error ? err.message : String(err))
        return null
      }
    })()
    cache.set(zipPath, task)
    return task
  }

  async function resolveSrc(src: string): Promise<string | null> {
    if (!src) return null
    // Already a data URI or absolute URL — leave alone.
    if (/^(data:|https?:|blob:)/i.test(src)) return null

    // Strip fragment
    const clean = src.split('#')[0]
    if (!clean) return null

    // Shape 1: getChapter()-rewritten path like `/images/{id}/{origPath}`
    if (imageroot && clean.startsWith(imageroot)) {
      const rest = clean.slice(imageroot.length) // "{id}/{origPath}"
      const slash = rest.indexOf('/')
      if (slash > 0) {
        const id = rest.slice(0, slash)
        const item = manifest[id]
        if (item?.href) {
          return toDataUri(item.href, item['media-type'])
        }
      }
    }

    // Shape 2: relative path from raw HTML. Resolve against chapter dir.
    const resolved = posixResolve(chapterDir, clean)
    // Try direct hit first.
    let uri = await toDataUri(resolved)
    if (uri) return uri
    // Manifests sometimes list images with a slightly different path
    // (e.g. URL-encoded characters). Match by basename as a last resort.
    const base = resolved.split('/').pop() || ''
    for (const item of Object.values(manifest)) {
      const mime = (item['media-type'] ?? '').toLowerCase()
      if (!mime.startsWith('image/') && !item.href?.match(/\.(png|jpe?g|gif|webp|svg|bmp)$/i)) continue
      if (item.href && item.href.split('/').pop() === base) {
        uri = await toDataUri(item.href, item['media-type'])
        if (uri) return uri
      }
    }
    return null
  }

  // Collect all replacements up-front so we can await them in parallel, then
  // splice back into the string in one pass.
  interface Replacement { start: number; end: number; text: string }
  const tasks: Promise<Replacement | null>[] = []

  const attrRe = /(<(?:img|image)\b[^>]*?\s(?:src|href|xlink:href)\s*=\s*)(["'])([^"']+)\2/gi
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(html)) !== null) {
    const full = m[0]
    const prefix = m[1]
    const quote = m[2]
    const src = m[3]
    const start = m.index
    const end = start + full.length
    tasks.push(
      resolveSrc(src).then((uri) => (uri ? { start, end, text: `${prefix}${quote}${uri}${quote}` } : null))
    )
  }

  const results = (await Promise.all(tasks)).filter((r): r is Replacement => r !== null)
  if (results.length === 0) return html

  // Splice from the tail so earlier offsets stay valid.
  results.sort((a, b) => b.start - a.start)
  let out = html
  for (const r of results) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end)
  }
  return out
}

function posixDirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

function posixResolve(dir: string, rel: string): string {
  // Absolute path inside the ZIP — leading slash is treated as ZIP root.
  if (rel.startsWith('/')) rel = rel.slice(1)
  const parts = (dir ? dir.split('/') : []).concat(rel.split('/'))
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') { out.pop(); continue }
    out.push(part)
  }
  return out.join('/')
}

function mimeFromExt(path: string): string | null {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    case 'bmp': return 'image/bmp'
    case 'ico': return 'image/x-icon'
    default: return null
  }
}
