import { extname } from 'node:path'
import { extractPdfText } from './pdf-parser'
import { extractEpubText, getEpubChapters } from './epub-parser'

export interface ParseResult {
  content: string
  totalPages: number
}

export type { EpubChapter, EpubChaptersResult } from './epub-parser'
export { getEpubChapters }

export async function extractText(filePath: string): Promise<ParseResult> {
  const ext = extname(filePath).toLowerCase()

  switch (ext) {
    case '.pdf':
      return extractPdfText(filePath)
    case '.epub':
      return extractEpubText(filePath)
    default:
      throw new Error(`Unsupported file format: ${ext}`)
  }
}
