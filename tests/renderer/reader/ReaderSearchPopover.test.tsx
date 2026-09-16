// @vitest-environment jsdom
/**
 * ReaderSearchPopover — shared Ctrl+F shell used by the EPUB / PDF readers.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import { ReaderSearchPopover } from '../../../src/renderer/src/reader/ReaderSearchPopover'

afterEach(cleanup)

describe('ReaderSearchPopover', () => {
  it('renders the query value and reports typing', () => {
    const onQueryChange = vi.fn()
    render(
      <ReaderSearchPopover
        inputRef={createRef<HTMLInputElement>()}
        query="卷积"
        onQueryChange={onQueryChange}
        placeholder="输入关键词，回车搜索..."
      />
    )

    const input = screen.getByPlaceholderText('输入关键词，回车搜索...')
    expect((input as HTMLInputElement).value).toBe('卷积')

    fireEvent.change(input, { target: { value: '积分' } })
    expect(onQueryChange).toHaveBeenCalledWith('积分')
  })

  it('forwards keydown and attaches the given ref', () => {
    const onKeyDown = vi.fn()
    const ref = createRef<HTMLInputElement>()
    render(
      <ReaderSearchPopover
        inputRef={ref}
        query=""
        onQueryChange={() => {}}
        onKeyDown={onKeyDown}
        placeholder="输入关键词"
      />
    )

    const input = screen.getByPlaceholderText('输入关键词')
    expect(ref.current).toBe(input)

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it('renders the controls and the result area slots', () => {
    render(
      <ReaderSearchPopover
        inputRef={createRef<HTMLInputElement>()}
        query="卷积"
        onQueryChange={() => {}}
        placeholder="输入关键词"
        controls={<button>搜索</button>}
      >
        <p>未找到匹配</p>
      </ReaderSearchPopover>
    )

    expect(screen.getByRole('button', { name: '搜索' })).toBeTruthy()
    expect(screen.getByText('未找到匹配')).toBeTruthy()
  })

  it('applies the width override for the narrower PDF panel', () => {
    const { container } = render(
      <ReaderSearchPopover
        inputRef={createRef<HTMLInputElement>()}
        query=""
        onQueryChange={() => {}}
        placeholder="输入关键词"
        widthClass="w-72"
      />
    )

    expect(container.firstElementChild?.className).toContain('w-72')
    expect(container.firstElementChild?.className).toContain('absolute')
  })
})
