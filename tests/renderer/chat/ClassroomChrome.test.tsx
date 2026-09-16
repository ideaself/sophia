// @vitest-environment jsdom
/**
 * ClassroomHeader + ConversationSearchBar — extracted classroom chrome.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createRef } from 'react'

import { ClassroomHeader } from '../../../src/renderer/src/chat/ClassroomHeader'
import { ConversationSearchBar } from '../../../src/renderer/src/chat/ConversationSearchBar'

type HeaderProps = Parameters<typeof ClassroomHeader>[0]

afterEach(() => {
  cleanup()
})

function headerProps(overrides: Partial<HeaderProps> = {}): HeaderProps {
  return {
    companionName: '朗道',
    companionIdentity: '化学导师',
    conversationId: 'conv_1',
    title: '07-06 朗道',
    editingTitle: false,
    titleInput: '07-06 朗道',
    pace: 'normal',
    classMode: 'standard',
    textbookTitle: '热力学入门',
    hasTextbookOriginal: true,
    readerOpen: false,
    isStreaming: false,
    isReasoning: false,
    dailyGoal: 60,
    todayMinutes: 30,
    endingClass: false,
    onRename: vi.fn(),
    onTitleInputChange: vi.fn(),
    onSaveTitle: vi.fn(),
    onCancelEditTitle: vi.fn(),
    onPaceChange: vi.fn(),
    onToggleFeynman: vi.fn(),
    onToggleReader: vi.fn(),
    onScreenshot: vi.fn(),
    onEndClass: vi.fn(),
    ...overrides
  }
}

function renderHeader(overrides: Partial<HeaderProps> = {}) {
  const props = headerProps(overrides)
  render(<ClassroomHeader {...props} />)
  return props
}

describe('ClassroomHeader', () => {
  it('shows companion identity, textbook chip and the goal ring', () => {
    renderHeader()

    expect(screen.getByText('朗道')).toBeTruthy()
    expect(screen.getByText('化学导师')).toBeTruthy()
    expect(screen.getByText(/热力学入门/)).toBeTruthy()
    expect(screen.getByText('30/60m')).toBeTruthy()
  })

  it('hides the goal ring when the daily goal is disabled', () => {
    renderHeader({ dailyGoal: 0 })
    expect(screen.queryByText(/30\/60m/)).toBeNull()
  })

  it('switches pace and toggles feynman mode', () => {
    const props = renderHeader()

    fireEvent.click(screen.getByText('快'))
    expect(props.onPaceChange).toHaveBeenCalledWith('fast')

    fireEvent.click(screen.getByText(/标准课堂/))
    expect(props.onToggleFeynman).toHaveBeenCalled()
  })

  it('opens the reader only when the textbook has an original file', () => {
    const props = renderHeader()
    fireEvent.click(screen.getByText(/教材阅读/))
    expect(props.onToggleReader).toHaveBeenCalled()

    cleanup()
    renderHeader({ hasTextbookOriginal: false })
    expect(screen.queryByText(/教材阅读/)).toBeNull()
  })

  it('edits the title inline (rename → input → save/cancel)', () => {
    const props = renderHeader({ editingTitle: true })

    const input = screen.getByDisplayValue('07-06 朗道')
    fireEvent.change(input, { target: { value: '新名字' } })
    expect(props.onTitleInputChange).toHaveBeenCalledWith('新名字')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onSaveTitle).toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(props.onCancelEditTitle).toHaveBeenCalled()
  })

  it('starts title editing from the rename button', () => {
    const props = renderHeader()
    fireEvent.click(screen.getByText(/07-06 朗道/))
    expect(props.onRename).toHaveBeenCalled()
  })

  it('shows the streaming status and disables the end-class button while ending', () => {
    renderHeader({ isStreaming: true, isReasoning: true })
    expect(screen.getByText('正在推理…')).toBeTruthy()

    cleanup()
    renderHeader({ endingClass: true })
    expect((screen.getByText('处理中...') as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides conversation-scoped controls without a conversation', () => {
    renderHeader({ conversationId: null })
    expect(screen.queryByText('下课')).toBeNull()
    expect(screen.queryByText(/07-06 朗道/)).toBeNull()
  })
})

describe('ConversationSearchBar', () => {
  function searchProps(overrides: Partial<Parameters<typeof ConversationSearchBar>[0]> = {}) {
    return {
      inputRef: createRef<HTMLInputElement>(),
      query: 'entropy',
      matchIndex: 1,
      matchCount: 5,
      onQueryChange: vi.fn(),
      onGoToMatch: vi.fn(),
      onClose: vi.fn(),
      ...overrides
    }
  }

  it('shows the current match position and navigates with Enter / Shift+Enter', () => {
    const props = searchProps()
    render(<ConversationSearchBar {...props} />)

    expect(screen.getByDisplayValue('entropy')).toBeTruthy()
    expect(screen.getByText('2/5')).toBeTruthy()

    const input = screen.getByDisplayValue('entropy')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onGoToMatch).toHaveBeenCalledWith(1)

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(props.onGoToMatch).toHaveBeenCalledWith(-1)

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })

  it('parses typing and disables navigation when there are no matches', () => {
    const props = searchProps({ matchCount: 0, matchIndex: 0 })
    render(<ConversationSearchBar {...props} />)

    fireEvent.change(screen.getByDisplayValue('entropy'), { target: { value: 'x' } })
    expect(props.onQueryChange).toHaveBeenCalledWith('x')

    expect(screen.getByText('0/0')).toBeTruthy()
    expect((screen.getByTitle('上一个 (Shift+Enter)') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTitle('下一个 (Enter)') as HTMLButtonElement).disabled).toBe(true)
  })
})
