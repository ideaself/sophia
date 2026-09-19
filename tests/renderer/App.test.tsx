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
  ClassroomView: ({
    companion,
    textbook,
    onConversationLoaded
  }: {
    companion: { name: string } | null
    textbook: { title: string } | null
    onConversationLoaded?: () => void
  }) => (
    <div data-testid="classroom-view">
      <span>{companion?.name ?? '无伙伴'}</span>
      <span>{textbook?.title ?? '无教材'}</span>
      <button onClick={onConversationLoaded}>已加载会话</button>
    </div>
  )
}))
vi.mock('../../src/renderer/src/components/SettingsView', () => ({
  SettingsView: () => <div data-testid="settings-view" />
}))
vi.mock('../../src/renderer/src/components/CompanionsManageView', () => ({
  CompanionsManageView: ({ onStartConversation }: { onStartConversation: (c: unknown) => void }) => (
    <div data-testid="companions-view">
      <button
        onClick={() =>
          onStartConversation({
            id: 'comp_landau',
            name: '朗道',
            identity: '理论物理学家',
            personalityKeywords: []
          })
        }
      >
        开始对话
      </button>
    </div>
  )
}))
vi.mock('../../src/renderer/src/components/StatsView', () => ({
  StatsView: () => <div data-testid="stats-view" />
}))
vi.mock('../../src/renderer/src/components/NewClassroomModal', () => ({
  NewClassroomModal: ({
    initialCompanion,
    onConfirm,
    onCancel
  }: {
    initialCompanion: { name: string } | null
    onConfirm: (c: unknown, t: unknown) => void
    onCancel: () => void
  }) => (
    <div data-testid="new-classroom-modal">
      <span>{initialCompanion?.name ?? '未预选'}</span>
      <button onClick={onCancel}>取消</button>
      <button
        onClick={() =>
          onConfirm(
            { id: 'comp_new', name: '新伙伴', identity: 'x', personalityKeywords: [] },
            { id: 'tb9', title: '教材九', format: 'pdf', originalFile: 'f.pdf' }
          )
        }
      >
        确认
      </button>
    </div>
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
  FlashcardReviewView: ({ onClearScope }: { onClearScope: () => void }) => (
    <div data-testid="flashcards-view">
      <button onClick={onClearScope}>清除范围</button>
    </div>
  )
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
  getTextbook: vi.fn(async (): Promise<unknown> => null),
  dueFlashcardCount: vi.fn(async () => ({ due: 0, total: 0 })),
  dueConceptCount: vi.fn(async () => ({ due: 0, total: 0 }))
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
  data.dueConceptCount.mockClear().mockResolvedValue({ due: 0, total: 0 })
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
  it('shows the combined badge and records the daily reminder', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    data.dueFlashcardCount.mockResolvedValue({ due: 150, total: 150 })
    data.dueConceptCount.mockResolvedValue({ due: 3, total: 4 })
    const NotificationSpy = vi.fn()
    Object.defineProperty(window, 'Notification', { configurable: true, value: NotificationSpy })
    render(<App />)

    expect(await screen.findByText('99+')).toBeTruthy()
    expect(screen.getByTitle('待复习：150 张卡片 · 3 个概念')).toBeTruthy()
    await waitFor(() =>
      expect(localStorage.getItem('sophia.dueReminderDate')).toBe(new Date().toDateString())
    )
    expect(NotificationSpy).toHaveBeenCalledWith(
      '复习提醒',
      expect.objectContaining({
        body: expect.stringContaining('150 张记忆卡片、3 个概念')
      })
    )
  })

  it('reminds about due flashcards without mentioning concepts', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    data.dueFlashcardCount.mockResolvedValue({ due: 1, total: 1 })
    const NotificationSpy = vi.fn()
    Object.defineProperty(window, 'Notification', { configurable: true, value: NotificationSpy })
    render(<App />)

    await waitFor(() =>
      expect(NotificationSpy).toHaveBeenCalledWith(
        '复习提醒',
        expect.objectContaining({ body: expect.stringContaining('1 张记忆卡片') })
      )
    )
    const body = NotificationSpy.mock.calls[0][1].body as string
    expect(body).not.toContain('概念')
  })

  it('reminds about due concepts even when no card is due', async () => {    localStorage.setItem('sophia.onboardingDone', '1')
    data.dueConceptCount.mockResolvedValue({ due: 2, total: 2 })
    const NotificationSpy = vi.fn()
    Object.defineProperty(window, 'Notification', { configurable: true, value: NotificationSpy })
    render(<App />)

    expect(await screen.findByTitle('待复习：0 张卡片 · 2 个概念')).toBeTruthy()
    await waitFor(() =>
      expect(NotificationSpy).toHaveBeenCalledWith(
        '复习提醒',
        expect.objectContaining({ body: expect.stringContaining('2 个概念') })
      )
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
        textbookId: 'tb_thermo'
      },
      {
        id: 'c_mid',
        companionId: 'comp_landau',
        title: '中间',
        endedAt: null,
        updatedAt: '2026-09-10T10:00:00Z',
        textbookId: null
      }
    ])
    companionsApi.get.mockResolvedValue({
      id: 'comp_landau',
      name: '朗道',
      identity: '理论物理学家',
      personalityKeywords: []
    })
    data.getTextbook.mockResolvedValue({
      id: 'tb_thermo',
      title: '热力学教材',
      format: 'pdf',
      originalFile: 'th.pdf'
    })

    render(<App />)

    await waitFor(() => expect(useAppStore.getState().loadConversationId).toBe('c_new'))
    expect(await screen.findByText('朗道')).toBeTruthy()
    expect(data.getTextbook).toHaveBeenCalledWith('tb_thermo')
    await waitFor(() =>
      expect(useTextbookStore.getState().selectedTextbook?.title).toBe('热力学教材')
    )
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

  it('confirms a new classroom and clears the modal state', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    render(<App />)
    await screen.findByTestId('classroom-view')

    fireEvent.click(menu('课堂'))
    fireEvent.click(await screen.findByText('+ 新建课堂'))
    fireEvent.click(await screen.findByText('确认'))

    await waitFor(() => expect(screen.queryByTestId('new-classroom-modal')).toBeNull())
    expect(useAppStore.getState().view).toBe('classroom')
    expect(useAppStore.getState().newClassroomOpen).toBe(false)
    expect(useAppStore.getState().newClassroomPreselect).toBeNull()
    expect(useCompanionStore.getState().selectedCompanion?.name).toBe('新伙伴')
    expect(useTextbookStore.getState().selectedTextbook?.title).toBe('教材九')
    expect(await screen.findByText('教材九')).toBeTruthy()
  })

  it('cancels the new-classroom modal', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    render(<App />)
    await screen.findByTestId('classroom-view')

    fireEvent.click(menu('课堂'))
    fireEvent.click(await screen.findByText('+ 新建课堂'))
    fireEvent.click(await screen.findByText('取消'))

    await waitFor(() => expect(screen.queryByTestId('new-classroom-modal')).toBeNull())
    expect(useAppStore.getState().newClassroomOpen).toBe(false)
  })
})

describe('App — classroom shell wiring', () => {
  it('revalidates the selected companion and toggles the dropdown', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    companionsApi.get.mockResolvedValue({
      id: 'comp_landau',
      name: '朗道',
      identity: '理论物理学家',
      personalityKeywords: []
    })
    useCompanionStore.setState({
      selectedCompanion: { id: 'comp_landau', name: '旧名', identity: 'x', personalityKeywords: [] } as never
    })
    render(<App />)
    await screen.findByTestId('classroom-view')

    // Selected companion → first click opens the dropdown (and refreshes data).
    fireEvent.click(menu('课堂'))
    expect(await screen.findByText('没有进行中的课堂')).toBeTruthy()
    await waitFor(() =>
      expect(useCompanionStore.getState().selectedCompanion?.name).toBe('朗道')
    )

    // Second click closes it again.
    fireEvent.click(menu('课堂'))
    await waitFor(() => expect(screen.queryByText('选择课堂')).toBeNull())

    // Escape closes it too.
    fireEvent.click(menu('课堂'))
    await screen.findByText('选择课堂')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('选择课堂')).toBeNull())
  })

  it('clears a stale selected companion that no longer exists', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    companionsApi.get.mockRejectedValue(new Error('companion gone'))
    useCompanionStore.setState({
      selectedCompanion: { id: 'comp_gone', name: '旧伙伴', identity: 'x', personalityKeywords: [] } as never
    })
    render(<App />)
    await screen.findByTestId('classroom-view')

    fireEvent.click(menu('课堂'))

    await waitFor(() => expect(useCompanionStore.getState().selectedCompanion).toBeNull())
    expect(await screen.findByText('无伙伴')).toBeTruthy()
  })

  it('resumes a conversation with its textbook attached', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    useConversationStore.setState({
      activeConversations: [
        {
          id: 'c_tb',
          title: '热力学',
          companionId: 'comp_landau',
          companionName: '朗道',
          textbookId: 'tb_thermo',
          textbookTitle: '热力学教材',
          updatedAt: '2026-09-16T10:00:00Z',
          endedAt: null
        } as never
      ],
      fetchActive: vi.fn(async () => {})
    })
    companionsApi.get.mockResolvedValue({
      id: 'comp_landau',
      name: '朗道',
      identity: '理论物理学家',
      personalityKeywords: []
    })
    data.getTextbook.mockResolvedValue({
      id: 'tb_thermo',
      title: '热力学教材',
      format: 'pdf',
      originalFile: 'th.pdf'
    })

    render(<App />)
    await screen.findByTestId('classroom-view')

    fireEvent.click(menu('课堂'))
    fireEvent.click(await screen.findByText('朗道'))

    await waitFor(() => expect(data.getTextbook).toHaveBeenCalledWith('tb_thermo'))
    await waitFor(() =>
      expect(useTextbookStore.getState().selectedTextbook?.title).toBe('热力学教材')
    )
    expect(await screen.findByText('热力学教材')).toBeTruthy()
  })

  it('starts a classroom for a companion picked in the manage view', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    render(<App />)
    await screen.findByTestId('classroom-view')

    fireEvent.click(menu('角色'))
    fireEvent.click(await screen.findByText('开始对话'))

    const modal = await screen.findByTestId('new-classroom-modal')
    expect(modal.textContent).toContain('朗道')
  })

  it('clears the flashcards scope and renders the review view', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    useAppStore.setState({ view: 'flashcards', flashcardScope: { conversationId: 'c1', title: '复盘' } })
    render(<App />)

    fireEvent.click(await screen.findByText('清除范围'))
    await waitFor(() => expect(useAppStore.getState().flashcardScope).toBeNull())

    act(() => {
      useAppStore.setState({ view: 'review' })
    })
    expect(await screen.findByTestId('review-view')).toBeTruthy()
  })

  it('clears the pending conversation load when the classroom reports it loaded', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    useAppStore.setState({ loadConversationId: 'c1' })
    render(<App />)
    await screen.findByTestId('classroom-view')

    fireEvent.click(await screen.findByText('已加载会话'))
    await waitFor(() => expect(useAppStore.getState().loadConversationId).toBeNull())
  })
})

describe('App — bootstrapping edge cases', () => {
  it('unlocks when the lock check fails', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    data.lock.has.mockRejectedValueOnce(new Error('ipc down'))
    render(<App />)
    expect(await screen.findByTestId('classroom-view')).toBeTruthy()
  })

  it('skips the daily reminder when one was already sent today', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    localStorage.setItem('sophia.dueReminderDate', new Date().toDateString())
    const NotificationSpy = vi.fn()
    Object.defineProperty(window, 'Notification', { configurable: true, value: NotificationSpy })
    data.dueFlashcardCount.mockResolvedValue({ due: 3, total: 3 })

    render(<App />)
    expect(await screen.findByText('3')).toBeTruthy()
    expect(NotificationSpy).not.toHaveBeenCalled()
  })

  it('re-applies the auto theme when the system scheme changes', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    localStorage.setItem('sophia-theme', 'auto')
    let dark = false
    const listeners: Array<() => void> = []
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: dark,
        media: query,
        onchange: null,
        addEventListener: (_event: string, cb: () => void) => listeners.push(cb),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      })
    })

    render(<App />)
    await screen.findByTestId('classroom-view')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    dark = true
    act(() => {
      listeners.forEach((cb) => cb())
    })
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('ignores lock submits without a PIN and while busy', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    data.lock.has.mockResolvedValue(true)
    render(<App />)
    await screen.findByText('学习档案已锁定')

    const form = document.querySelector('form')!
    fireEvent.submit(form)
    expect(data.lock.verify).not.toHaveBeenCalled()

    let release: (ok: boolean) => void = () => {}
    data.lock.verify.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (release = resolve))
    )
    fireEvent.change(screen.getByPlaceholderText('解锁密码'), { target: { value: '1234' } })
    fireEvent.click(screen.getByText('解锁'))
    expect(await screen.findByText('验证中...')).toBeTruthy()

    fireEvent.submit(form)
    expect(data.lock.verify).toHaveBeenCalledTimes(1)

    act(() => release(true))
    expect(await screen.findByTestId('classroom-view')).toBeTruthy()
  })
})

describe('App — branch closure', () => {
  it('boots a conversation whose companion no longer exists', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    data.listConversations.mockResolvedValue([
      {
        id: 'c_orphan',
        companionId: 'comp_gone',
        title: '孤儿课',
        endedAt: null,
        updatedAt: '2026-09-16T10:00:00Z'
      }
    ])
    companionsApi.get.mockResolvedValue(null)

    render(<App />)

    await waitFor(() => expect(useAppStore.getState().loadConversationId).toBe('c_orphan'))
    expect(companionsApi.get).toHaveBeenCalledWith('comp_gone')
    expect(useCompanionStore.getState().selectedCompanion).toBeNull()
  })

  it('boots a conversation whose textbook is missing from the library', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    data.listConversations.mockResolvedValue([
      {
        id: 'c_tb',
        companionId: 'comp_landau',
        title: '缺教材',
        endedAt: null,
        updatedAt: '2026-09-16T10:00:00Z',
        textbookId: 'tb_missing'
      }
    ])
    companionsApi.get.mockResolvedValue({
      id: 'comp_landau',
      name: '朗道',
      identity: '理论物理学家',
      personalityKeywords: []
    })
    data.getTextbook.mockResolvedValue(null)

    render(<App />)

    await waitFor(() => expect(data.getTextbook).toHaveBeenCalledWith('tb_missing'))
    expect(useTextbookStore.getState().selectedTextbook).toBeNull()
  })

  it('keeps the classroom dropdown open on inside clicks and other keys', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    render(<App />)
    await screen.findByTestId('classroom-view')

    fireEvent.click(menu('课堂'))
    await screen.findByText('选择课堂')

    fireEvent.mouseDown(screen.getByText('选择课堂'))
    expect(screen.getByText('选择课堂')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'a' })
    expect(screen.getByText('选择课堂')).toBeTruthy()
  })

  it('resumes conversations whose companion or textbook is gone', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    useConversationStore.setState({
      activeConversations: [
        {
          id: 'c_orphan',
          title: '孤儿课',
          companionId: 'comp_gone',
          companionName: '旧伙伴',
          textbookId: null,
          textbookTitle: null,
          updatedAt: '2026-09-16T10:00:00Z',
          endedAt: null
        },
        {
          id: 'c_tb',
          title: '缺教材',
          companionId: 'comp_landau',
          companionName: '朗道',
          textbookId: 'tb_gone',
          textbookTitle: '旧教材',
          updatedAt: '2026-09-16T10:00:00Z',
          endedAt: null
        }
      ] as never,
      fetchActive: vi.fn(async () => {})
    })
    companionsApi.get.mockResolvedValue(null)
    data.getTextbook.mockResolvedValue(null)

    render(<App />)
    await screen.findByTestId('classroom-view')

    fireEvent.click(menu('课堂'))
    fireEvent.click(await screen.findByText('旧伙伴'))
    await waitFor(() => expect(useAppStore.getState().loadConversationId).toBe('c_orphan'))

    fireEvent.click(menu('课堂'))
    fireEvent.click(await screen.findByText('朗道'))
    await waitFor(() => expect(useAppStore.getState().loadConversationId).toBe('c_tb'))
    expect(companionsApi.get).toHaveBeenCalledWith('comp_landau')
    expect(data.getTextbook).toHaveBeenCalledWith('tb_gone')
    expect(useTextbookStore.getState().selectedTextbook).toBeNull()
  })

  it('renders the create-companion modal without a delete action', async () => {
    localStorage.setItem('sophia.onboardingDone', '1')
    useCompanionStore.setState({ editingCompanion: null, isCreating: true })

    render(<App />)

    expect(await screen.findByTestId('companion-edit-modal')).toBeTruthy()
  })
})
