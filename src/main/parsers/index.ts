import { extname } from 'node:path'
import { extractPdfText } from './pdf-parser'
import { extractEpubText } from './epub-parser'

export interface ParseResult {
  content: string
  totalPages: number
}

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
