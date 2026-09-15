import { describe, it, expect } from 'vitest'
import { join } from 'node:path'

import {
  safeSegment,
  conversationDir,
  textbookDir,
  artifactPath,
  relationPath,
  palMomentsPathForTextbook,
  textbookNotesDir
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
    expect(() => safeSegment('爱丽丝')).toThrow('Invalid id for path')
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
    expect(relationPath(dataRoot, 'comp_alice')).toBe(join(dataRoot, 'relation_comp_alice.md'))
  })

  it('textbookNotesDir inherits textbookId validation', () => {
    expect(() => textbookNotesDir(dataRoot, '../x')).toThrow('Invalid id for path')
  })
})
