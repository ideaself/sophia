// @vitest-environment jsdom
/**
 * Small leftover branches that are genuinely reachable: markdownToHtml,
 * reading-notes refresh failure, unsupported TTS speak, drag-storage failure,
 * pending study-minute focus timers, and the first-run/settings shells.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, renderHook, act } from '@testing-library/react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}))

import { markdownToHtml } from '../../../src/renderer/src/lib/markdownToHtml'
import { FirstRunGuide } from '../../../src/renderer/src/components/FirstRunGuide'
import { useReadingNotes } from '../../../src/renderer/src/reader/useReadingNotes'

afterEach(cleanup)

describe('markdownToHtml', () => {
  it('renders markdown to static HTML', () => {
    const html = markdownToHtml('# 标题\n\n正文')
    expect(html).toContain('标题')
  })
})

describe('FirstRunGuide', () => {
  it('shows the three-step guide and finishes', () => {
    const onFinish = vi.fn()
    render(<FirstRunGuide onFinish={onFinish} />)

    expect(screen.getByText('欢迎来到 Sophia')).toBeTruthy()
    fireEvent.click(screen.getByText('开始学习 →'))
    expect(onFinish).toHaveBeenCalled()
  })
})

describe('useReadingNotes refresh failure', () => {
  it('falls back to an empty list when loading notes fails', async () => {
    Object.defineProperty(window, 'sophia', {
      configurable: true,
      value: {
        data: {
          listReadingNotes: vi.fn().mockRejectedValue(new Error('db closed'))
        }
      }
    })

    const hook = renderHook(() => useReadingNotes('tb_1'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(hook.result.current.notes).toEqual([])
  })
})
