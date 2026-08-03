import { describe, it, expect } from 'vitest'
import { normalizeMathDelimiters } from '../../src/shared/math-delimiters'

describe('normalizeMathDelimiters', () => {
  it('converts inline \(...\) to $...$', () => {
    expect(normalizeMathDelimiters('比如 \\(\\nabla\\cdot E=0\\) 这一条'))
      .toBe('比如 $\\nabla\\cdot E=0$ 这一条')
  })

  it('converts display \[...\] to $$...$$', () => {
    expect(normalizeMathDelimiters('\\[F = ma\\]')).toBe('$$F = ma$$')
  })

  it('leaves existing dollar math untouched', () => {
    const src = '既有 $x^2$ 和 $$\\int_a^b$$'
    expect(normalizeMathDelimiters(src)).toBe(src)
  })

  it('handles text without backslashes unchanged', () => {
    expect(normalizeMathDelimiters('普通文本')).toBe('普通文本')
    expect(normalizeMathDelimiters('')).toBe('')
  })

  it('mixes delimiters in one paragraph', () => {
    const src = '内联 \\(a+b\\) 与独立 \\[c+d\\] 混合'
    expect(normalizeMathDelimiters(src)).toBe('内联 $a+b$ 与独立 $$c+d$$ 混合')
  })
})
