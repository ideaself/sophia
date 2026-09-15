// @vitest-environment jsdom
/**
 * SelfTestBlock — gradual reveal of hints and the answer.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { SelfTestBlock } from '../../../src/renderer/src/components/SelfTestBlock'

afterEach(() => {
  cleanup()
})

const QUESTION = {
  question: '什么是熵？',
  hints: ['想想无序程度', '和热力学第二定律有关'],
  answer: '系统无序程度的度量。'
}

describe('SelfTestBlock', () => {
  it('starts with the answer hidden and reveals hints step by step', () => {
    render(<SelfTestBlock questions={[QUESTION]} />)

    expect(screen.getByText(/什么是熵？/)).toBeTruthy()
    expect(screen.queryByText(/无序程度的度量/)).toBeNull()

    fireEvent.click(screen.getByText('显示提示 1'))
    expect(screen.getByText('想想无序程度')).toBeTruthy()
    expect(screen.queryByText(/热力学第二定律/)).toBeNull()

    fireEvent.click(screen.getByText('显示提示 2'))
    expect(screen.getByText(/热力学第二定律/)).toBeTruthy()

    fireEvent.click(screen.getByText('显示答案'))
    expect(screen.getByText(/无序程度的度量/)).toBeTruthy()
    // Button becomes the terminal state.
    expect(screen.getByText('已显示答案 ✓')).toBeTruthy()
  })

  it('collapses back to the initial state', () => {
    render(<SelfTestBlock questions={[QUESTION]} />)

    fireEvent.click(screen.getByText('显示提示 1'))
    expect(screen.getByText('想想无序程度')).toBeTruthy()

    fireEvent.click(screen.getByText('收起'))
    expect(screen.queryByText('想想无序程度')).toBeNull()
    expect(screen.getByText('显示提示 1')).toBeTruthy()
  })

  it('keeps multiple questions independent', () => {
    render(
      <SelfTestBlock
        questions={[QUESTION, { question: '第二题？', hints: [], answer: '第二题答案' }]}
      />
    )

    // The hintless question labels its button 显示答案 directly.
    fireEvent.click(screen.getByText('显示答案'))
    expect(screen.getByText('第二题答案')).toBeTruthy()
    expect(screen.queryByText('想想无序程度')).toBeNull()
  })
})
