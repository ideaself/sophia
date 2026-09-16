// @vitest-environment jsdom
/**
 * ChatErrorRow + EndClassCard — message-list status rows.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { ChatErrorRow } from '../../../src/renderer/src/chat/ChatErrorRow'
import { EndClassCard } from '../../../src/renderer/src/chat/EndClassCard'

afterEach(() => {
  cleanup()
})

describe('ChatErrorRow', () => {
  it('shows the error message and a retry button when retry is available', () => {
    const onRetry = vi.fn()
    render(<ChatErrorRow message="network down" onRetry={onRetry} />)

    expect(screen.getByText('发送失败')).toBeTruthy()
    expect(screen.getByText('network down')).toBeTruthy()

    fireEvent.click(screen.getByText('重试'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('hides the retry button when no retry handler is given', () => {
    render(<ChatErrorRow message="boom" />)
    expect(screen.queryByText('重试')).toBeNull()
  })
})

describe('EndClassCard', () => {
  const base = { artifacts: 5 }

  it('shows the generating placeholder while artifacts are pending', () => {
    render(
      <EndClassCard
        result={{ ...base, pending: true }}
        redoing={false}
        onReviewNewCards={() => {}}
        onContinueLearning={() => {}}
        onRedoArtifacts={() => {}}
      />
    )

    expect(screen.getByText('课程已结束')).toBeTruthy()
    expect(screen.getByText(/后台生成中/)).toBeTruthy()
    // Actions appear only after generation completes.
    expect(screen.queryByText('复习本节新卡')).toBeNull()
  })

  it('shows artifact count and wires the review/continue actions', () => {
    const onReviewNewCards = vi.fn()
    const onContinueLearning = vi.fn()
    render(
      <EndClassCard
        result={{ ...base, farewell: '下次见！' }}
        redoing={false}
        onReviewNewCards={onReviewNewCards}
        onContinueLearning={onContinueLearning}
        onRedoArtifacts={() => {}}
      />
    )

    expect(screen.getByText(/已自动生成 5 个学习摘要/)).toBeTruthy()
    expect(screen.getByText('下次见！')).toBeTruthy()

    fireEvent.click(screen.getByText('复习本节新卡'))
    fireEvent.click(screen.getByText('继续学习'))
    expect(onReviewNewCards).toHaveBeenCalledTimes(1)
    expect(onContinueLearning).toHaveBeenCalledTimes(1)
  })

  it('offers redo for failed artifacts and disables it while redoing', () => {
    const onRedoArtifacts = vi.fn()
    const { rerender } = render(
      <EndClassCard
        result={{ ...base, failures: ['farewell', 'diary'] }}
        redoing={false}
        onReviewNewCards={() => {}}
        onContinueLearning={() => {}}
        onRedoArtifacts={onRedoArtifacts}
      />
    )

    expect(screen.getByText(/有 2 项学习摘要生成失败/)).toBeTruthy()
    fireEvent.click(screen.getByText('补齐缺失产物'))
    expect(onRedoArtifacts).toHaveBeenCalledTimes(1)

    rerender(
      <EndClassCard
        result={{ ...base, failures: ['farewell', 'diary'] }}
        redoing
        onReviewNewCards={() => {}}
        onContinueLearning={() => {}}
        onRedoArtifacts={onRedoArtifacts}
      />
    )
    expect((screen.getByText('补齐中...') as HTMLButtonElement).disabled).toBe(true)
  })

  it('surfaces background generation errors', () => {
    render(
      <EndClassCard
        result={{ ...base, generationError: '模型不可用' }}
        redoing={false}
        onReviewNewCards={() => {}}
        onContinueLearning={() => {}}
        onRedoArtifacts={() => {}}
      />
    )
    expect(screen.getByText(/后台生成失败：模型不可用/)).toBeTruthy()
  })
})
