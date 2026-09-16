// @vitest-environment jsdom
/**
 * StatsView — summary cards, weekly report distributions, the 14-day chart,
 * yearly heatmap tooltips and the Markdown weekly-report export.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { StatsView } from '../../../src/renderer/src/components/StatsView'

const DAY_MS = 24 * 60 * 60 * 1000
const MIN_MS = 60 * 1000

function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const today = new Date()
today.setHours(0, 0, 0, 0)
const yesterday = new Date(today.getTime() - DAY_MS)
const TODAY_KEY = localDayKey(today)
const YESTERDAY_KEY = localDayKey(yesterday)

const CONVERSATIONS = [
  { id: 'c1', title: '第一课', companionId: 'comp_a', textbookId: 'tb_1', createdAt: '', updatedAt: '', endedAt: '2026-07-06T10:00:00' },
  { id: 'c2', title: '第二课', companionId: 'comp_a', textbookId: 'tb_1', createdAt: '', updatedAt: '', endedAt: '2026-07-07T10:00:00' },
  { id: 'c3', title: '进行中', companionId: 'comp_b', textbookId: null, createdAt: '', updatedAt: '', endedAt: null }
]

const OVERVIEW = {
  dailyMinutes: { [TODAY_KEY]: 90 * MIN_MS, [YESTERDAY_KEY]: 30 * MIN_MS },
  totalMessages: 42,
  totalArtifacts: 7,
  week: {
    startKey: YESTERDAY_KEY,
    ms: 60 * MIN_MS,
    messages: 10,
    artifacts: 3,
    companion: { comp_a: 8, comp_b: 2 },
    textbook: { tb_1: 6, none: 4 }
  }
}

const dataMocks = {
  listConversations: vi.fn(),
  statsOverview: vi.fn(),
  listTextbooks: vi.fn(),
  writeTextFile: vi.fn()
}
const companionsGet = vi.fn()
const saveFile = vi.fn()

beforeEach(() => {
  for (const fn of Object.values(dataMocks)) fn.mockClear()
  companionsGet.mockClear()
  saveFile.mockClear()

  dataMocks.listConversations.mockResolvedValue(CONVERSATIONS)
  dataMocks.statsOverview.mockResolvedValue(OVERVIEW)
  dataMocks.listTextbooks.mockResolvedValue([{ id: 'tb_1', title: '化学课本' }])
  dataMocks.writeTextFile.mockResolvedValue(undefined)
  companionsGet.mockImplementation(async (id: string) => ({
    id,
    name: id === 'comp_a' ? '朗道' : '鲍勃',
    identity: '导师',
    personalityKeywords: []
  }))
  saveFile.mockResolvedValue({ canceled: false, filePath: 'C:\\out.md' })

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: {
      data: dataMocks,
      companions: { get: companionsGet },
      dialog: { saveFile }
    }
  })
})

afterEach(cleanup)

/** Summary/week cards render value + label as sibling <p>s. */
function cardValue(label: string, index = 0): string | undefined {
  return screen.getAllByText(label)[index].previousElementSibling?.textContent ?? undefined
}

describe('StatsView', () => {
  it('renders summary cards, the weekly report and distributions', async () => {
    render(<StatsView />)
    await screen.findByText('学习统计')

    expect(cardValue('总课堂数')).toBe('3')
    expect(cardValue('已完成')).toBe('2')
    expect(cardValue('累计学习时长')).toBe('2 小时')
    expect(cardValue('连续学习天数')).toBe('2')
    expect(cardValue('总消息数')).toBe('42')
    expect(cardValue('学习产物')).toBe('7')

    expect(screen.getByText('本周报告')).toBeTruthy()
    expect(cardValue('消息数')).toBe('10')
    expect(screen.getByText('1 小时')).toBeTruthy()

    expect(screen.getByText('化学课本')).toBeTruthy()
    expect(screen.getByText('未绑定教材')).toBeTruthy()
    expect(screen.getByText('6 条 · 60%')).toBeTruthy()
    expect(screen.getByText('4 条 · 40%')).toBeTruthy()
    expect(screen.getByText('8 条 · 80%')).toBeTruthy()
    expect(screen.getByText('2 条 · 20%')).toBeTruthy()

    expect(screen.getByText('当前有 1 个进行中的课堂')).toBeTruthy()
  })

  it('charts the last 14 days and the heatmap with duration tooltips', async () => {
    render(<StatsView />)
    await screen.findByText('学习统计')

    // Today / yesterday appear once in the bar chart and once in the heatmap.
    expect(screen.getAllByTitle(`${TODAY_KEY}: 1 小时 30 分钟`)).toHaveLength(2)
    expect(screen.getAllByTitle(`${YESTERDAY_KEY}: 30 分钟`)).toHaveLength(2)
  })

  it('shows empty states without any study data', async () => {
    dataMocks.listConversations.mockResolvedValue([])
    dataMocks.statsOverview.mockResolvedValue({
      dailyMinutes: {},
      totalMessages: 0,
      totalArtifacts: 0,
      week: { startKey: YESTERDAY_KEY, ms: 0, messages: 0, artifacts: 0, companion: {}, textbook: {} }
    })

    render(<StatsView />)
    await screen.findByText('学习统计')

    expect(cardValue('总课堂数')).toBe('0')
    expect(screen.getAllByText('暂无数据')).toHaveLength(2)
    expect(screen.getAllByText('本周暂无学习')).toHaveLength(2)
    expect(screen.queryByText(/进行中的课堂/)).toBeNull()
  })

  it('exports the weekly report as Markdown', async () => {
    render(<StatsView />)
    await screen.findByText('学习统计')

    fireEvent.click(screen.getByText('导出 Markdown'))

    await waitFor(() => expect(dataMocks.writeTextFile).toHaveBeenCalledTimes(1))
    const [path, content] = dataMocks.writeTextFile.mock.calls[0] as [string, string]
    expect(path).toBe('C:\\out.md')
    expect(content).toContain('# 学习周报')
    expect(content).toContain('- 学习时长：1 小时')
    expect(content).toContain('- 消息数：10')
    expect(content).toContain('- 连续学习天数：2')
    expect(content).toContain('- 化学课本：6 条（60%）')
    expect(content).toContain('- 未绑定教材：4 条（40%）')
    expect(content).toContain('- 朗道：8 条（80%）')
  })

  it('skips the write when the save dialog is cancelled', async () => {
    saveFile.mockResolvedValue({ canceled: true })

    render(<StatsView />)
    await screen.findByText('学习统计')
    fireEvent.click(screen.getByText('导出 Markdown'))

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(dataMocks.writeTextFile).not.toHaveBeenCalled()
  })
})
