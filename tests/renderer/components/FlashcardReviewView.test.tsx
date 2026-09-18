// @vitest-environment jsdom
/**
 * FlashcardReviewView — core review flow:
 * flip, rate (mouse + keyboard), SRS persistence, deck progression.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

import { FlashcardReviewView } from '../../../src/renderer/src/components/FlashcardReviewView'

const CARD_CONTENT = [
  '- 问题：什么是卷积？',
  '- 答案：一种积分运算',
  '- 问题：傅里叶变换的作用？',
  '- 答案：时频转换'
].join('\n')

const saveSrsSpy = vi.fn().mockResolvedValue(undefined)
const data = {
  listConversations: vi.fn(),
  listArtifacts: vi.fn(),
  getFlashcardSrsState: vi.fn(),
  getFlashcardFavorites: vi.fn(),
  saveFlashcardSrsState: saveSrsSpy,
  saveFlashcardFavorites: vi.fn().mockResolvedValue(undefined),
  getArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteFlashcardCards: vi.fn(),
  writeTextFile: vi.fn()
}
const dialog = {
  saveFile: vi.fn(),
  confirm: vi.fn()
}

function conversation(id: string, title: string): Record<string, unknown> {
  return { id, title, companionId: 'comp_a', endedAt: '2026-07-06T10:00:00Z' }
}

function flashcardsArtifact(
  id: string,
  conversationId: string,
  content: string
): Record<string, unknown> {
  return { id, conversationId, type: 'flashcards', content, createdAt: '2026-07-06T10:00:00Z' }
}

beforeEach(() => {
  for (const fn of Object.values(data)) fn.mockClear()
  for (const fn of Object.values(dialog)) fn.mockClear()

  data.listConversations.mockResolvedValue([conversation('c1', '07-06 朗道')])
  data.listArtifacts.mockResolvedValue([flashcardsArtifact('art_1', 'c1', CARD_CONTENT)])
  data.getFlashcardSrsState.mockResolvedValue({})
  data.getFlashcardFavorites.mockResolvedValue([])
  data.saveFlashcardSrsState.mockResolvedValue(undefined)
  data.saveFlashcardFavorites.mockResolvedValue(undefined)
  data.getArtifact.mockResolvedValue(null)
  data.updateArtifact.mockResolvedValue(null)
  data.deleteFlashcardCards.mockResolvedValue({ success: true, deleted: 0 })
  data.writeTextFile.mockResolvedValue({ success: true })
  dialog.saveFile.mockResolvedValue({ canceled: false, filePath: 'C:\\out.txt' })
  dialog.confirm.mockResolvedValue(true)

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data, dialog }
  })
  saveSrsSpy.mockClear()
})

afterEach(() => {
  cleanup()
})

async function renderView(): Promise<void> {
  render(<FlashcardReviewView />)
  await screen.findByText('什么是卷积？')
}

describe('FlashcardReviewView — review flow', () => {
  it('loads the deck and shows the first question with rating controls hidden', async () => {
    await renderView()

    expect(screen.getByText('什么是卷积？')).toBeTruthy()
    expect(screen.getByText('翻转卡片后评分')).toBeTruthy()
    expect(screen.queryByText('良好')).toBeNull()
    // Second card is not shown yet.
    expect(screen.queryByText('傅里叶变换的作用？')).toBeNull()
  })

  it('flips on click and rates with the mouse, persisting SRS state', async () => {
    await renderView()

    fireEvent.click(screen.getByText('什么是卷积？'))

    expect(screen.getByText('一种积分运算')).toBeTruthy()
    fireEvent.click(screen.getByText('良好'))

    // SRS state written for the first card (key = artifactId_index).
    expect(saveSrsSpy).toHaveBeenCalledTimes(1)
    const payload = saveSrsSpy.mock.calls[0][0] as Record<string, { reps: number }>
    expect(payload['art_1_0']).toBeDefined()
    expect(payload['art_1_0'].reps).toBe(1)

    // Advanced to the next (flip reset) card.
    expect(screen.getByText('傅里叶变换的作用？')).toBeTruthy()
    expect(screen.getByText('翻转卡片后评分')).toBeTruthy()
  })

  it('supports keyboard flow: Space flips, digits rate', async () => {
    await renderView()

    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByText('一种积分运算')).toBeTruthy()

    fireEvent.keyDown(window, { key: '3' })
    expect(saveSrsSpy).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(screen.getByText('傅里叶变换的作用？')).toBeTruthy()
    })
  })

  it('ignores rating keys while the card is not flipped', async () => {
    await renderView()

    fireEvent.keyDown(window, { key: '3' })
    expect(saveSrsSpy).not.toHaveBeenCalled()
    // Still on the first card.
    expect(screen.getByText('什么是卷积？')).toBeTruthy()
  })

  it('does not rate when typing in an input', async () => {
    await renderView()
    fireEvent.click(screen.getByText('什么是卷积？'))
    expect(screen.getByText('良好')).toBeTruthy()

    // The edit form has a textarea; keys typed there must not rate the card.
    fireEvent.click(screen.getByText('修正'))
    const textareas = screen.getAllByRole('textbox')
    fireEvent.keyDown(textareas[0], { key: '3' })

    expect(saveSrsSpy).not.toHaveBeenCalled()
  })

  it('ignores flipped-card keys that map to no rating', async () => {
    await renderView()

    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByText('一种积分运算')).toBeTruthy()

    fireEvent.keyDown(window, { key: '9' })
    expect(saveSrsSpy).not.toHaveBeenCalled()
    expect(screen.getByText('一种积分运算')).toBeTruthy()
  })

  it('rates the last card without advancing past the deck', async () => {
    data.listArtifacts.mockResolvedValue([
      flashcardsArtifact('art_1', 'c1', '- 问题：唯一的问题？\n- 答案：唯一的答案')
    ])

    render(<FlashcardReviewView />)
    await screen.findByText('唯一的问题？')

    fireEvent.click(screen.getByText('唯一的问题？'))
    fireEvent.click(screen.getByText('良好'))

    await waitFor(() => expect(saveSrsSpy).toHaveBeenCalledTimes(1))
    // No next card: the rated card stays visible with its answer.
    expect(screen.getByText('唯一的答案')).toBeTruthy()
    expect(screen.getByText(/1\/1/)).toBeTruthy()
  })
})

describe('FlashcardReviewView — deck, tabs and empty states', () => {
  it('shows the no-cards empty state', async () => {
    data.listArtifacts.mockResolvedValue([])

    render(<FlashcardReviewView />)

    expect(await screen.findByText('暂无记忆卡片')).toBeTruthy()
  })

  it('shows the empty favorites state and can switch back to all', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('珍藏（0）'))

    expect(await screen.findByText('还没有珍藏卡片')).toBeTruthy()
    // The 珍藏 tab is already active; clicking it keeps the empty state.
    fireEvent.click(screen.getByText('珍藏（0）'))
    expect(screen.getByText('还没有珍藏卡片')).toBeTruthy()

    fireEvent.click(screen.getByText('全部（2）'))
    expect(await screen.findByText('什么是卷积？')).toBeTruthy()
  })

  it('sorts due cards ahead of future-scheduled ones', async () => {
    data.getFlashcardSrsState.mockResolvedValue({
      art_1_0: { nextReview: Date.now() + 3 * 24 * 60 * 60 * 1000, interval: 3, reps: 2 },
      art_1_1: { nextReview: 0, interval: 0, reps: 0 }
    })

    render(<FlashcardReviewView />)

    // The due (second) card is shown first.
    expect(await screen.findByText('傅里叶变换的作用？')).toBeTruthy()
  })

  it('labels scheduled cards with 明天 and N 天后', async () => {
    const soon = Date.now() + 24 * 60 * 60 * 1000
    data.getFlashcardSrsState.mockResolvedValue({
      art_1_0: { nextReview: soon, interval: 1, reps: 1, ease: 2.5, lastReview: Date.now() },
      art_1_1: { nextReview: soon + 1, interval: 5, reps: 3, ease: 2.5, lastReview: Date.now() }
    })

    render(<FlashcardReviewView />)

    expect(await screen.findByText(/下次：明天/)).toBeTruthy()
    fireEvent.click(screen.getByText('跳过'))
    expect(await screen.findByText(/下次：5 天后/)).toBeTruthy()
  })

  it('shuffles within the favorites tab and keeps favorites first', async () => {
    data.getFlashcardFavorites.mockResolvedValue(['art_1_0'])

    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('珍藏（1）'))
    fireEvent.click(screen.getByText('打乱顺序'))

    // The favorited card stays in the deck after the favorites-aware shuffle.
    expect(await screen.findByText('什么是卷积？')).toBeTruthy()

    // And the 全部 tab is reachable again from the main UI.
    fireEvent.click(screen.getByText('全部（2）'))
    expect(await screen.findByText('什么是卷积？')).toBeTruthy()
  })

  it('runs a scoped lesson review when the lesson has enough cards', async () => {
    const lessonContent = Array.from({ length: 5 }, (_, i) =>
      [`- 问题：本课问题 ${i + 1}？`, `- 答案：本课答案 ${i + 1}`].join('\n')
    ).join('\n')
    data.listArtifacts.mockResolvedValue([flashcardsArtifact('art_scope', 'c1', lessonContent)])

    render(
      <FlashcardReviewView
        scope={{ conversationId: 'c1', title: '本课' }}
        onClearScope={vi.fn()}
      />
    )

    expect(await screen.findByText('本课问题 1？')).toBeTruthy()
    expect(screen.getByText(/正在复习/)).toBeTruthy()
    expect(screen.getByText('返回全部卡片')).toBeTruthy()
  })
})

describe('FlashcardReviewView — selection, export and management', () => {
  it('selects, clears and batch-deletes cards', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('批量操作'))
    await waitFor(() => expect(document.body.textContent).toContain('已选 0 张'))

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    await waitFor(() => expect(document.body.textContent).toContain('已选 1 张'))

    fireEvent.click(screen.getByText('全选当前列表'))
    await waitFor(() => expect(document.body.textContent).toContain('已选 2 张'))

    fireEvent.click(screen.getByText('清空'))
    await waitFor(() => expect(document.body.textContent).toContain('已选 0 张'))

    // Delete flow: confirm → data call → selection cleared.
    fireEvent.click(screen.getByText('全选当前列表'))
    fireEvent.click(screen.getByText('批量删除'))

    await waitFor(() =>
      expect(data.deleteFlashcardCards).toHaveBeenCalledWith([
        { conversationId: 'c1', artifactId: 'art_1', cardIndex: 0 },
        { conversationId: 'c1', artifactId: 'art_1', cardIndex: 1 }
      ])
    )
    await waitFor(() => expect(document.body.textContent).toContain('已选 0 张'))
  })

  it('keeps the selection when the delete confirmation is declined', async () => {
    dialog.confirm.mockResolvedValue(false)

    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('批量操作'))
    fireEvent.click(screen.getByText('全选当前列表'))
    fireEvent.click(screen.getByText('批量删除'))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(data.deleteFlashcardCards).not.toHaveBeenCalled()
    await waitFor(() => expect(document.body.textContent).toContain('已选 2 张'))
  })

  it('skips the export when the selection no longer matches the visible tab', async () => {
    data.getFlashcardFavorites.mockResolvedValue(['art_1_0'])

    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('批量操作'))
    // Select the non-favorited card, then switch to the favorites tab.
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])
    await waitFor(() => expect(document.body.textContent).toContain('已选 1 张'))

    fireEvent.click(screen.getByText('珍藏（1）'))
    fireEvent.click(screen.getByText('批量导出 Anki'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Target list was empty → no file dialog, no write.
    expect(dialog.saveFile).not.toHaveBeenCalled()
    expect(data.writeTextFile).not.toHaveBeenCalled()
  })

  it('exports the selected cards through the save dialog', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('批量操作'))
    fireEvent.click(screen.getByText('全选当前列表'))
    fireEvent.click(screen.getByText('批量导出 Anki'))

    await waitFor(() => expect(data.writeTextFile).toHaveBeenCalled())
    const [filePath, content] = data.writeTextFile.mock.calls[0] as [string, string]
    expect(filePath).toBe('C:\\out.txt')
    expect(content).toContain('什么是卷积？')
    expect(content).toContain('时频转换')
  })
})

describe('FlashcardReviewView — rating and editing', () => {
  it('rates with 再看', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('什么是卷积？'))
    fireEvent.click(screen.getByText('再看'))

    await waitFor(() => expect(saveSrsSpy).toHaveBeenCalledTimes(1))
    // "Again" resets the card: reps drop back to 0, review due tomorrow.
    const payload = saveSrsSpy.mock.calls[0][0] as Record<string, { reps: number; nextReview: number }>
    expect(payload['art_1_0']?.reps).toBe(0)
    expect(payload['art_1_0']?.nextReview).toBeGreaterThan(Date.now())
  })

  it('rates with 困难', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('什么是卷积？'))
    fireEvent.click(screen.getByText('困难'))

    await waitFor(() => expect(saveSrsSpy).toHaveBeenCalledTimes(1))
    expect((saveSrsSpy.mock.calls[0][0] as Record<string, unknown>)['art_1_0']).toBeDefined()
  })

  it('rates with 简单', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('什么是卷积？'))
    fireEvent.click(screen.getByText('简单'))

    await waitFor(() => expect(saveSrsSpy).toHaveBeenCalledTimes(1))
    expect((saveSrsSpy.mock.calls[0][0] as Record<string, unknown>)['art_1_0']).toBeDefined()
  })

  it('closes the edit form without saving', async () => {
    render(<FlashcardReviewView />)
    await screen.findByText('什么是卷积？')

    fireEvent.click(screen.getByText('什么是卷积？'))
    fireEvent.click(screen.getByText('修正'))
    expect(await screen.findByText('修正卡片')).toBeTruthy()

    fireEvent.click(screen.getByText('取消'))

    await waitFor(() => expect(screen.queryByText('修正卡片')).toBeNull())
    expect(data.updateArtifact).not.toHaveBeenCalled()
    expect(screen.getByText('上一张')).toBeTruthy()
  })
})
