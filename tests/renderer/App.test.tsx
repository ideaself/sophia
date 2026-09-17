// @vitest-environment jsdom
/**
 * App shell — navigation, classroom dropdown, lock gate, first-run guide,
 * theme/font-scale bootstrapping and the offline banner.
 *
 * All views (static and lazy) are stubbed with markers: this file tests the
 * shell wiring, not the views themselves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'

vi.mock('../../src/renderer/src/chat/ClassroomView', () => ({
  ClassroomView: ({ companion }: { companion: { name: string } | null }) => (
    <div data-testid="classroom-view">{companion?.name ?? '无伙伴'}</div>
  )
}))
vi.mock('../../src/renderer/src/components/SettingsView', () => ({
  SettingsView: () => <div data-testid="settings-view" />
}))
vi.mock('../../src/renderer/src/components/CompanionsManageView', () => ({
  CompanionsManageView: () => <div data-testid="companions-view" />
}))
vi.mock('../../src/renderer/src/components/StatsView', () => ({
  StatsView: () => <div data-testid="stats-view" />
}))
vi.mock('../../src/renderer/src/components/NewClassroomModal', () => ({
  NewClassroomModal: ({ initialCompanion }: { initialCompanion: { name: string } | null }) => (
    <div data-testid="new-classroom-modal">{initialCompanion?.name ?? '未预选'}</div>
  )
}))
vi.mock('../../src/renderer/src/components/CompanionEditModal', () => ({
  CompanionEditModal: () => <div data-testid="companion-edit-modal" />
}))
vi.mock('../../src/renderer/src/components/FirstRunGuide', () => ({
  FirstRunGuide: ({ onFinish }: { onFinish: () => void }) => (
    <button data-testid="first-run-guide" onClick={onFinish}>
      完成引导
    </button>
  )
}))
vi.mock('../../src/renderer/src/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children?: React.ReactNode }) => <>{children}</>
}))
vi.mock('../../src/renderer/src/components/TextbooksView', () => ({
  TextbooksView: () => <div data-testid="textbooks-view" />
}))
vi.mock('../../src/renderer/src/components/HistoryView', () => ({
  HistoryView: () => <div data-testid="history-view" />
}))
vi.mock('../../src/renderer/src/components/FlashcardReviewView', () => ({
  FlashcardReviewView: () => <div data-testid="flashcards-view" />
}))
vi.mock('../../src/renderer/src/components/ReviewView', () => ({
  ReviewView: () => <div data-testid="review-view" />
}))

import App from '../../src/renderer/src/App'
import { useAppStore } from '../../src/renderer/src/stores/useAppStore'
import { useCompanionStore } from '../../src/renderer/src/stores/useCompanionStore'
import { useTextbookStore } from '../../src/renderer/src/stores/useTextbookStore'
import { useConversationStore } from '../../src/renderer/src/stores/useConversationStore'

const data = {
  lock: { has: vi.fn(async () => false), verify: vi.fn(async () => true) },
  listConversations: vi.fn(async () => [] as unknown[]),
  getTextbook: vi.fn(async () => null),
  dueFlashcardCount: vi.fn(async () => ({ due: 0, total: 0 }))
}
const companionsApi = { get: vi.fn(async () => null as unknown) }
const chatApi = {
  startStream: vi.fn(async () => 'sess-1'),
  cancelStream: vi.fn(async () => {}),
  onToken: vi.fn(() => () => {}),
  onThinking: vi.fn(() => () => {}),
  onError: vi.fn(() => () => {}),
  onEnd: vi.fn(() => () => {}),
  onUsage: vi.fn(() => () => {}),
  getPromptMessages: vi.fn(async () => [])
}

beforeEach(() => {
  localStorage.clear()
  data.lock.has.mockClear().mockResolvedValue(false)
  data.lock.verify.mockClear().mockResolvedValue(true)
  data.listConversations.mockClear().mockResolvedValue([])
  data.getTextbook.mockClear().mockResolvedValue(null)
  data.dueFlashcardCount.mockClear().mockResolvedValue({ due: 0, total: 0 })
  companionsApi.get.mockClear().mockResolvedValue(null)

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data, companions: companionsApi, chat: chatApi }
  })

  // jsdom has no matchMedia; the theme bootstrap listens to it in auto mode.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })

  useAppStore.setState({
    view: 'classroom',
    showClassroomDropdown: false,
    loadConversationId: null,
    newClassroomOpen: false,
    newClassroomPreselect: null,
    flashcardScope: null,
    freshClassroomNonce: 0
  })
  useCompanionStore.setState({
    selectedCompanion: null,
    editingCompanion: null,
    isCreating: false,
    fetch: vi.fn(async () => {}),
    closeEdit: vi.fn()
  })
  useTextbookStore.setState({ selectedTextbook: null, fetch: vi.fn(async () => {}) })
  useConversationStore.setState({ activeConversations: [], fetchActive: vi.fn(async () => {}) })
})

afterEach(cleanup)

function menu(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

describe('App — navigation', () => {
  it('boots into the classroom view', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    render(<App />)
    expect(await screen.findByTestId('classroom-view')).toBeTruthy()
  })

  it('switches between all views from the menu', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    companionsApi.get.mockResolvedValue({
      id: 'comp_landau',
      name: '朗道',
      identity: '理论物理学家',
      personalityKeywords: []
    })
    useCompanionStore.setState({
      selectedCompanion: { id: 'comp_landau', name: '朗道', identity: 'x', personalityKeywords: [] } as never
    })
    render(<App />)
    await screen.findByTestId('classroom-view')

    fireEvent.click(menu('历史'))
    expect(await screen.findByTestId('history-view')).toBeTruthy()

    fireEvent.click(menu('教材'))
    expect(await screen.findByTestId('textbooks-view')).toBeTruthy()

    fireEvent.click(menu('角色'))
    expect(await screen.findByTestId('companions-view')).toBeTruthy()

    fireEvent.click(menu('复习'))
    expect(await screen.findByTestId('flashcards-view')).toBeTruthy()

    fireEvent.click(menu('统计'))
    expect(await screen.findByTestId('stats-view')).toBeTruthy()

    fireEvent.click(menu('设置'))
    expect(await screen.findByTestId('settings-view')).toBeTruthy()

    // With a companion selected, the classroom menu jumps straight back.
    fireEvent.click(menu('课堂'))
    expect(await screen.findByTestId('classroom-view')).toBeTruthy()
  })

  it('renders the review-scoped flashcards view when a scope is set', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    useAppStore.setState({ view: 'flashcards', flashcardScope: { conversationId: 'c1', title: '复盘' } })
    render(<App />)
    expect(await screen.findByTestId('flashcards-view')).toBeTruthy()
  })
})

describe('App — classroom dropdown', () => {
  it('lists active conversations and resumes one', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    const conv = {
      id: 'c1',
      title: '热力学',
      companionId: 'comp_landau',
      companionName: '朗道',
      textbookId: null,
      textbookTitle: null,
      updatedAt: '2026-09-16T10:00:00Z',
      endedAt: null
    }
    useConversationStore.setState({
      activeConversations: [conv as never],
      fetchActive: vi.fn(async () => {})
    })
    companionsApi.get.mockResolvedValue({
      id: 'comp_landau',
      name: '朗道',
      identity: '理论物理学家',
      personalityKeywords: []
    })

    render(<App />)
    await screen.findByTestId('classroom-view')

    fireEvent.click(menu('课堂'))
    expect(await screen.findByText('选择课堂')).toBeTruthy()
    fireEvent.click(await screen.findByText('朗道'))

    await waitFor(() => expect(companionsApi.get).toHaveBeenCalledWith('comp_landau'))
    await waitFor(() => expect(useAppStore.getState().loadConversationId).toBe('c1'))
    expect(screen.queryByText('选择课堂')).toBeNull()
  })

  it('opens the new-classroom modal from the dropdown', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    render(<App />)
    await screen.findByTestId('classroom-view')

    fireEvent.click(menu('课堂'))
    fireEvent.click(await screen.findByText('+ 新建课堂'))

    expect(await screen.findByTestId('new-classroom-modal')).toBeTruthy()
    expect(screen.queryByText('选择课堂')).toBeNull()
  })

  it('shows the empty state and closes on outside click', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    render(<App />)
    await screen.findByTestId('classroom-view')

    fireEvent.click(menu('课堂'))
    expect(await screen.findByText('没有进行中的课堂')).toBeTruthy()

    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByText('选择课堂')).toBeNull())
  })
})

describe('App — due flashcards badge', () => {
  it('shows the badge and records the daily reminder', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    data.dueFlashcardCount.mockResolvedValue({ due: 150, total: 150 })
    render(<App />)

    expect(await screen.findByText('99+')).toBeTruthy()
    await waitFor(() =>
      expect(localStorage.getItem('sophia.dueReminderDate')).toBe(new Date().toDateString())
    )
  })
})

describe('App — bootstrapping', () => {
  it('applies the stored theme and default font scale', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    localStorage.setItem('sophia-theme', 'light')
    render(<App />)
    await screen.findByTestId('classroom-view')

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.style.fontSize).toBe('16px')

    cleanup()
    localStorage.setItem('sophia.fontScale', 'large')
    render(<App />)
    await screen.findByTestId('classroom-view')
    expect(document.documentElement.style.fontSize).toBe('18px')
  })

  it('resumes the most recent active conversation on launch', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    data.listConversations.mockResolvedValue([
      {
        id: 'c_old',
        companionId: 'comp_landau',
        title: '旧',
        endedAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z'
      },
      {
        id: 'c_new',
        companionId: 'comp_landau',
        title: '新',
        endedAt: null,
        updatedAt: '2026-09-16T10:00:00Z',
        textbookId: null
      }
    ])
    companionsApi.get.mockResolvedValue({
      id: 'comp_landau',
      name: '朗道',
      identity: '理论物理学家',
      personalityKeywords: []
    })

    render(<App />)

    await waitFor(() => expect(useAppStore.getState().loadConversationId).toBe('c_new'))
    expect(await screen.findByText('朗道')).toBeTruthy()
  })

  it('shows the offline banner when the connection drops', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    render(<App />)
    await screen.findByTestId('classroom-view')

    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(await screen.findByText(/网络连接已断开/)).toBeTruthy()
  })

  it('shows the guide once and remembers it was finished', async () => {
    render(<App />)
    const guide = await screen.findByTestId('first-run-guide')

    fireEvent.click(guide)

    await waitFor(() => expect(screen.queryByTestId('first-run-guide')).toBeNull())
    expect(localStorage.getItem('sophia.onboardingDone')).toBe('1')
  })
})

describe('App — profile lock', () => {
  it('gates the app behind the lock screen and verifies the PIN', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    data.lock.has.mockResolvedValue(true)
    data.lock.verify.mockResolvedValue(true)

    render(<App />)

    expect(await screen.findByText('学习档案已锁定')).toBeTruthy()
    const pin = screen.getByPlaceholderText('解锁密码')
    fireEvent.change(pin, { target: { value: '1234' } })
    fireEvent.click(screen.getByText('解锁'))

    await waitFor(() => expect(data.lock.verify).toHaveBeenCalledWith('1234'))
    expect(await screen.findByTestId('classroom-view')).toBeTruthy()
  })

  it('rejects a wrong PIN and can re-lock via the global event', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    data.lock.has.mockResolvedValue(true)
    data.lock.verify.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    render(<App />)
    await screen.findByText('学习档案已锁定')

    fireEvent.change(screen.getByPlaceholderText('解锁密码'), { target: { value: '0000' } })
    fireEvent.click(screen.getByText('解锁'))
    expect(await screen.findByText('密码错误，请重试')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('解锁密码'), { target: { value: '1234' } })
    fireEvent.click(screen.getByText('解锁'))
    await screen.findByTestId('classroom-view')

    act(() => {
      window.dispatchEvent(new Event('sophia:relock'))
    })
    expect(await screen.findByText('学习档案已锁定')).toBeTruthy()
  })
})

describe('App — modals', () => {
  it('renders the companion edit modal for the active edit state', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    useCompanionStore.setState({ editingCompanion: { id: 'c1', name: '朗道', identity: 'x', personalityKeywords: [] } as never })
    render(<App />)

    expect(await screen.findByTestId('companion-edit-modal')).toBeTruthy()
  })
})
