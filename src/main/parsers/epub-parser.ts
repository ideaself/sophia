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

  for (const chapter of epub.flow) {
    try {
      const html = await epub.getChapter(chapter.id)
      chapters.push({
        id: chapter.id,
        title: typeof chapter.title === 'string' && chapter.title ? chapter.title : `Chapter ${chapter.index}`,
        html
      })
    } catch (err) {
      // A failing chapter is not fatal — the rest of the book is still
      // readable — but the user should at least see it in the logs so a
      // reproducibly-empty book doesn't look like a bug in the reader.
      console.warn(`[epub-parser] Failed to load chapter ${chapter.id} (${chapter.title ?? '?'}):`, err instanceof Error ? err.message : String(err))
    }
  }

  return {
    chapters,
    title: epub.metadata?.title ?? '',
    author: epub.metadata?.creator ?? ''
  }
}
