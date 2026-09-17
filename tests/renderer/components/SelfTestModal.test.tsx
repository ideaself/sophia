// @vitest-environment jsdom
/**
 * SelfTestModal — staged reveal self-test: hints one by one, then the answer,
 * then next question / finish.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { SelfTestModal } from '../../../src/renderer/src/components/SelfTestModal'

const QUESTIONS = [
  { question: '什么是熵？', hints: ['与无序度有关', '状态函数'], answer: '无序度的度量' },
  { question: '什么是焓？', hints: [], answer: '等压热效应' }
]

afterEach(cleanup)

function renderModal(): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  render(<SelfTestModal questions={QUESTIONS as never} onClose={onClose} />)
  return { onClose }
}

describe('SelfTestModal', () => {
  it('reveals hints one at a time and then the answer', () => {
    renderModal()

    expect(screen.getByText('第 1/2 题')).toBeTruthy()
    expect(screen.getByText('先自己作答，再逐步显示提示和答案。')).toBeTruthy()

    fireEvent.click(screen.getByText('显示提示 1'))
    expect(screen.getByText('提示 1')).toBeTruthy()
    expect(screen.getByText('与无序度有关')).toBeTruthy()

    fireEvent.click(screen.getByText('显示提示 2'))
    expect(screen.getByText('提示 2')).toBeTruthy()
    expect(screen.getByText('状态函数')).toBeTruthy()

    fireEvent.click(screen.getByText('显示答案'))
    expect(screen.getByText('答案')).toBeTruthy()
    expect(screen.getByText('无序度的度量')).toBeTruthy()
  })

  it('advances to the next question and finishes on the last one', () => {
    const { onClose } = renderModal()

    // Reveal everything on question 1, then move on with the accent button.
    fireEvent.click(screen.getByText('显示提示 1'))
    fireEvent.click(screen.getByText('显示提示 2'))
    fireEvent.click(screen.getByText('显示答案'))
    fireEvent.click(screen.getAllByText('下一题')[0])

    expect(screen.getByText('第 2/2 题')).toBeTruthy()
    // The new question starts with nothing revealed.
    expect(screen.queryByText('答案')).toBeNull()
    expect(screen.getByText('先自己作答，再逐步显示提示和答案。')).toBeTruthy()

    // Question 2 has no hints: the first reveal is the answer itself.
    fireEvent.click(screen.getByText('显示提示 1'))
    expect(screen.getByText('等压热效应')).toBeTruthy()
    fireEvent.click(screen.getByText('完成'))
    expect(onClose).toHaveBeenCalled()
  })

  it('pages with the footer buttons and resets the reveal state', () => {
    renderModal()

    fireEvent.click(screen.getByText('显示提示 1'))
    expect(screen.getByText('提示 1')).toBeTruthy()

    fireEvent.click(screen.getByText('下一题'))
    expect(screen.getByText('第 2/2 题')).toBeTruthy()

    fireEvent.click(screen.getByText('上一题'))
    expect(screen.getByText('第 1/2 题')).toBeTruthy()
    // Back on question 1 with nothing revealed.
    expect(screen.queryByText('提示 1')).toBeNull()
  })

  it('disables paging at the edges and closes from the header / backdrop', () => {
    const { onClose } = renderModal()

    expect((screen.getByText('上一题') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTitle('关闭 (Esc)'))
    expect(onClose).toHaveBeenCalledTimes(1)

    // The backdrop (outermost) also closes.
    fireEvent.click(document.querySelector('.fixed.inset-0') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)

    // Clicking the panel itself does not.
    fireEvent.click(screen.getByText('课后自测'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
