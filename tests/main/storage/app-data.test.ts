import { describe, it, expect } from 'vitest'
import { join } from 'node:path'

import {
  safeSegment,
  conversationDir,
  textbookDir,
  artifactPath,
  relationPath,
  palMomentsPathForTextbook,
  textbookNotesDir,
  diaryPath,
  textbookOriginalPath
} from '../../../src/main/storage/app-data'

const dataRoot = 'C:\\data\\sophia'

describe('safeSegment', () => {
  it('accepts plain id segments', () => {
    expect(safeSegment('conv_123-abc')).toBe('conv_123-abc')
  })

  it('rejects path traversal and separators', () => {
    for (const bad of ['..', '../x', '..\\x', 'a/b', 'a\\b', '', 'a b', 'a.b']) {
      expect(() => safeSegment(bad), bad).toThrow('Invalid id for path')
    }
  })

  it('rejects overlong and non-ASCII ids', () => {
    expect(() => safeSegment('a'.repeat(129))).toThrow('Invalid id for path')
    expect(() => safeSegment('朗道')).toThrow('Invalid id for path')
  })
})

describe('path builders refuse unsafe ids', () => {
  it('conversationDir refuses traversal', () => {
    expect(() => conversationDir(dataRoot, '..\\..\\config')).toThrow('Invalid id for path')
    expect(conversationDir(dataRoot, 'conv_1')).toBe(join(dataRoot, 'conversations', 'conv_1'))
  })

  it('textbookDir refuses traversal', () => {
    expect(() => textbookDir(dataRoot, '../../etc')).toThrow('Invalid id for path')
    expect(textbookDir(dataRoot, 'tb_1')).toBe(join(dataRoot, 'textbooks', 'tb_1'))
  })

  it('artifactPath refuses an unsafe artifact id', () => {
    expect(() => artifactPath(dataRoot, 'conv_1', '..\\x')).toThrow('Invalid id for path')
    expect(artifactPath(dataRoot, 'conv_1', 'art_1')).toBe(
      join(dataRoot, 'conversations', 'conv_1', 'artifacts', 'art_1.json')
    )
  })

  it('relationPath and palMomentsPathForTextbook refuse traversal', () => {
    expect(() => relationPath(dataRoot, '../../x')).toThrow('Invalid id for path')
    expect(() => palMomentsPathForTextbook(dataRoot, '../../x')).toThrow('Invalid id for path')
    expect(relationPath(dataRoot, 'comp_landau')).toBe(join(dataRoot, 'relation_comp_landau.md'))
  })

  it('textbookNotesDir inherits textbookId validation', () => {
    expect(() => textbookNotesDir(dataRoot, '../x')).toThrow('Invalid id for path')
  })
})

describe('diary and original-file paths', () => {
  it('sanitizes unparseable diary months to "unknown"', () => {
    expect(diaryPath(dataRoot, '2026-07')).toBe(join(dataRoot, 'diary', '2026-07.md'))
    expect(diaryPath(dataRoot, 'nope')).toBe(join(dataRoot, 'diary', 'unknown.md'))
  })

  it('derives extensions from bare formats and keeps full file names', () => {
    const dir = join(dataRoot, 'textbooks', 'tb_1')
    expect(textbookOriginalPath(dataRoot, 'tb_1', 'epub')).toBe(join(dir, 'source.epub'))
    expect(textbookOriginalPath(dataRoot, 'tb_1', 'pdf')).toBe(join(dir, 'source.pdf'))
    expect(textbookOriginalPath(dataRoot, 'tb_1', 'markdown')).toBe(join(dir, 'source.pdf'))
    expect(textbookOriginalPath(dataRoot, 'tb_1', 'my-book.pdf')).toBe(join(dir, 'my-book.pdf'))
  })
})
