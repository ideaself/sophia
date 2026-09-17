// @vitest-environment jsdom
/**
 * FlashcardReviewView — navigation, favorites, card editing, shuffle,
 * export scopes, batch operations and scoped-deck supplements.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

import { FlashcardReviewView } from '../../../src/renderer/src/components/FlashcardReviewView'

const LESSON_CONTENT = '- 问题：什么是卷积？\n- 答案：一种积分运算'
const OTHER_CONTENT = [
  '- 问题：什么是熵？',
  '- 答案：状态函数',
  '- 问题：卡诺循环是什么？',
  '- 答案：理想热机循环'
].join('\n')

const data = {
  listConversations: vi.fn(),
  listArtifacts: vi.fn(),
  getFlashcardSrsState: vi.fn(),
  getFlashcardFavorites: vi.fn(),
  saveFlashcardSrsState: vi.fn(),
  saveFlashcardFavorites: vi.fn(),
  getArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteFlashcardCards: vi.fn(),
  writeTextFile: vi.fn()
}
const dialog = {
  saveFile: vi.fn(
    async (): Promise<{ canceled: boolean; filePath?: string }> => ({
      canceled: false,
      filePath: 'C:\\cards.txt'
    })
  ),
  confirm: vi.fn(async () => true)
}

const ARTIFACTS = [
  {
    id: 'art_1',
    conversationId: 'c1',
    type: 'flashcards',
    content: LESSON_CONTENT,
    createdAt: '2026-07-06T10:00:00Z'
  },
  {
    id: 'art_2',
    conversationId: 'c2',
    type: 'flashcards',
    content: OTHER_CONTENT,
    createdAt: '2026-07-05T10:00:00Z'
  }
]

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(data)) fn.mockClear()
  dialog.saveFile.mockClear().mockResolvedValue({ canceled: false, filePath: 'C:\\cards.txt' })
  dialog.confirm.mockClear().mockResolvedValue(true)

  data.listConversations.mockResolvedValue([
    { id: 'c1', title: '07-06 朗道', companionId: 'comp_a', endedAt: '2026-07-06T10:00:00Z' },
    { id: 'c2', title: '07-05 祖冲之', companionId: 'comp_b', endedAt: '2026-07-05T10:00:00Z' }
  ])
  data.listArtifacts.mockImplementation(async (convId: string) =>
    convId === 'c1' ? [ARTIFACTS[0]] : [ARTIFACTS[1]]
  )
  data.getFlashcardSrsState.mockResolvedValue({})
  data.getFlashcardFavorites.mockResolvedValue([])
  data.saveFlashcardSrsState.mockResolvedValue(undefined)
  data.saveFlashcardFavorites.mockResolvedValue(undefined)
  data.getArtifact.mockResolvedValue(ARTIFACTS[0])
  data.updateArtifact.mockResolvedValue(null)
  data.deleteFlashcardCards.mockResolvedValue({ success: true, deleted: 1 })
  data.writeTextFile.mockResolvedValue(undefined)

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data, dialog }
  })
})

afterEach(cleanup)

describe('FlashcardReviewView — navigation and favorites', () => {
  it('walks the deck with 跳过/上一张 and resets the flip state', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')
    expect(screen.getByText(/1\/3/)).toBeTruthy()

    fireEvent.click(screen.getByText('跳过'))
    expect(await screen.findByText('什么是熵？')).toBeTruthy()
    expect(screen.getByText(/2\/3/)).toBeTruthy()

    fireEvent.click(screen.getByText('上一张'))
    expect(await screen.findByText('什么是卷积？')).toBeTruthy()
    expect((screen.getByText('上一张') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByText('跳过'))
    fireEvent.click(screen.getByText('跳过'))
    expect((screen.getByText('跳过') as HTMLButtonElement).disabled).toBe(true)
  })

  it('toggles favorites, persists them and filters the favorites tab', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByTitle('加入珍藏'))
    await waitFor(() =>
      expect(data.saveFlashcardFavorites).toHaveBeenCalledWith(['art_1_0'])
    )
    expect(screen.getByTitle('取消珍藏')).toBeTruthy()

    fireEvent.click(screen.getByText(/^珍藏（/))
    expect(await screen.findByText('什么是卷积？')).toBeTruthy()
    expect(screen.getByText(/1\/1/)).toBeTruthy()

    // Unfavoriting from the filtered tab empties it.
    fireEvent.click(screen.getByTitle('取消珍藏'))
    expect(await screen.findByText(/还没有珍藏卡片/)).toBeTruthy()
  })

  it('shuffles and restarts the deck from the first card', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')
    fireEvent.click(screen.getByText('跳过'))
    await screen.findByText('什么是熵？')

    fireEvent.click(screen.getByText('打乱顺序'))

    await waitFor(() => expect(screen.getByText(/1\/3/)).toBeTruthy())
  })
})

describe('FlashcardReviewView — editing', () => {
  it('edits a card and persists the rebuilt artifact content', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('什么是卷积？'))
    fireEvent.click(screen.getByTitle('改正答案或解释'))
    const question = (await screen.findByDisplayValue('什么是卷积？')) as HTMLInputElement
    const answer = (await screen.findByDisplayValue('一种积分运算')) as HTMLInputElement
    fireEvent.change(question, { target: { value: '什么是离散卷积？' } })
    fireEvent.change(answer, { target: { value: '一种求和运算' } })
    fireEvent.click(screen.getByText('保存修正'))

    await waitFor(() =>
      expect(data.updateArtifact).toHaveBeenCalledWith(
        'art_1',
        'c1',
        expect.stringContaining('什么是离散卷积？')
      )
    )
    // The editor closes after a successful save.
    await waitFor(() => expect(screen.queryByText('保存修正')).toBeNull())
  })

  it('validates the question and reports missing or changed source data', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    // Empty question.
    fireEvent.click(screen.getByText('什么是卷积？'))
    fireEvent.click(screen.getByTitle('改正答案或解释'))
    fireEvent.change(await screen.findByDisplayValue('什么是卷积？'), { target: { value: '  ' } })
    fireEvent.click(screen.getByText('保存修正'))
    expect(await screen.findByText('问题不能为空')).toBeTruthy()

    // Missing artifact.
    data.getArtifact.mockResolvedValueOnce(null)
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: '新问题' } })
    fireEvent.click(screen.getByText('保存修正'))
    expect(await screen.findByText('找不到原卡片数据')).toBeTruthy()

    // The stored card list shrank.
    data.getArtifact.mockResolvedValueOnce({ ...ARTIFACTS[0], content: '' })
    fireEvent.click(screen.getByText('保存修正'))
    expect(await screen.findByText('原卡片内容已变化，请刷新后重试')).toBeTruthy()

    // Save failure.
    data.updateArtifact.mockRejectedValueOnce(new Error('disk full'))
    fireEvent.click(screen.getByText('保存修正'))
    expect(await screen.findByText('保存失败，请重试')).toBeTruthy()
  })
})

describe('FlashcardReviewView — export', () => {
  it('exports the chosen scope as Anki text', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('导出 Anki'))
    fireEvent.click(await screen.findByText(/导出全部卡片（3 张）/))

    await waitFor(() => expect(data.writeTextFile).toHaveBeenCalledTimes(1))
    const [path, content] = data.writeTextFile.mock.calls[0] as [string, string]
    expect(path).toBe('C:\\cards.txt')
    expect(content).toContain('什么是卷积？')
    expect(content).toContain('什么是熵？')
  })

  it('skips the write when the save dialog is cancelled', async () => {
    dialog.saveFile.mockResolvedValueOnce({ canceled: true })
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('导出 Anki'))
    fireEvent.click(await screen.findByText(/导出当前列表（3 张）/))

    await waitFor(() => expect(dialog.saveFile).toHaveBeenCalled())
    expect(data.writeTextFile).not.toHaveBeenCalled()
  })
})

describe('FlashcardReviewView — batch operations', () => {
  it('selects all, batch-exports and batch-deletes after confirmation', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('批量操作'))
    fireEvent.click(screen.getByText('全选当前列表'))
    expect(screen.getByText(/已选/)).toBeTruthy()

    fireEvent.click(screen.getByText('批量导出 Anki'))
    await waitFor(() => expect(data.writeTextFile).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('批量删除'))
    await waitFor(() => expect(data.deleteFlashcardCards).toHaveBeenCalledTimes(1))
    const cards = data.deleteFlashcardCards.mock.calls[0][0] as Array<{
      conversationId: string
      artifactId: string
      cardIndex: number
    }>
    expect(cards).toHaveLength(3)
    expect(cards[0]).toMatchObject({ conversationId: 'c1', artifactId: 'art_1', cardIndex: 0 })
  })

  it('keeps the selection when the delete confirmation is declined', async () => {
    dialog.confirm.mockResolvedValueOnce(false)
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('批量操作'))
    fireEvent.click(screen.getByText('全选当前列表'))
    fireEvent.click(screen.getByText('批量删除'))

    await waitFor(() => expect(dialog.confirm).toHaveBeenCalled())
    expect(data.deleteFlashcardCards).not.toHaveBeenCalled()
  })
})

describe('FlashcardReviewView — scoped review', () => {
  it('supplements a small lesson deck with due cards from other lessons', async () => {
    render(<FlashcardReviewView scope={{ conversationId: 'c1', title: '07-06 朗道' }} />)
    await screen.findByText('什么是卷积？')

    // 1 lesson card + 2 due cards from other lessons.
    expect(await screen.findByText(/1\/3/)).toBeTruthy()
    fireEvent.click(screen.getByText('跳过'))
    expect(await screen.findByText('什么是熵？')).toBeTruthy()
  })

  it('tracks session counters while rating', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('什么是卷积？'))
    fireEvent.click(await screen.findByText('良好'))

    expect(await screen.findByText(/本次已复习 1 · 答对 1/)).toBeTruthy()
    expect(data.saveFlashcardSrsState).toHaveBeenCalledTimes(1)
  })
})
