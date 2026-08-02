import { describe, it, expect } from 'vitest'
import { findBodyStartPage } from '../../../src/main/parsers/pdf-front-matter'

const TITLE = '   \n Great Book Title \n  \n'
const COPYRIGHT = '© 2026 Some Publisher\nAll rights reserved.\n'
const TOC = 'Contents\n\nChapter 1 Introduction ...... 3\nChapter 2 Method ...... 15\nChapter 3 Results ...... 40\nIndex ...... 120\n'
const PREFACE = 'Preface\nThis book grew out of years of teaching. I owe a debt to many colleagues.\n'
const BODY = 'Chapter 1 Introduction\n\nEvery scientific investigation begins with a question. The aim of this chapter is to set out the terms we will use throughout.\n'

describe('findBodyStartPage', () => {
  it('skips title, copyright, TOC and preface pages', () => {
    const pages = [TITLE, COPYRIGHT, TOC, PREFACE, BODY]
    expect(findBodyStartPage(pages)).toBe(4)
  })

  it('returns 0 when there is no front matter', () => {
    const pages = [BODY, BODY]
    expect(findBodyStartPage(pages)).toBe(0)
  })

  it('returns 0 for an empty input', () => {
    expect(findBodyStartPage([])).toBe(0)
  })

  it('does not skip a real first chapter page', () => {
    const pages = [BODY, 'Chapter 2 More\n\nProse here.\n']
    expect(findBodyStartPage(pages)).toBe(0)
  })

  it('skips sparse front matter only up to the cap (does not over-skip)', () => {
    // A book with a long run of sparse pages — body must still be found.
    const sparse = Array.from({ length: 30 }, (_, i) => `Page ${i + 1} of front matter — short lines, no real prose here yet.`)
    const pages = [...sparse, BODY]
    const start = findBodyStartPage(pages)
    // The cap limits how far we scan; we must not report a page past the body.
    expect(start).toBeLessThan(pages.length)
    expect(start).toBeLessThanOrEqual(30)
  })
})
