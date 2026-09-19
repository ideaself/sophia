// @vitest-environment jsdom
/**
 * ChatMessage markdown pipeline — rendered with the real MarkdownRenderer so
 * the overridden code/pre/blockquote components and the citation chip run.
 * Mermaid is stubbed (the real block pulls a heavy diagram renderer).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, configure } from '@testing-library/react'

// The markdown vendor stack is heavy — allow slower first paints in CI.
configure({ asyncUtilTimeout: 15000 })
vi.setConfig({ testTimeout: 45000 })

vi.mock('../../../src/renderer/src/components/MermaidBlock', () => ({
  MermaidBlock: ({ code }: { code: string }) => <div data-testid="mermaid">{code}</div>
}))

import { ChatMessage } from '../../../src/renderer/src/chat/ChatMessage'
import MarkdownRenderer from '../../../src/renderer/src/lib/MarkdownRenderer'

beforeAll(async () => {
  // Warm the lazy() import so the first render isn't a cold module load.
  // Generous timeout: the vendor markdown stack is heavy under coverage.
  await import('../../../src/renderer/src/lib/MarkdownRenderer')
}, 60_000)

const searchExcerpt = vi.fn()
const translateExcerpt = vi.fn()
const writeText = vi.fn(async (_text: string) => {})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  searchExcerpt.mockReset()
  translateExcerpt.mockReset()
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  })
  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data: { searchTextbookExcerpt: searchExcerpt, translateTextbookExcerpt: translateExcerpt } }
  })
})

afterEach(() => {
  cleanup()
})

describe('MarkdownRenderer default code pipeline', () => {
  it('renders inline code without a language class and fenced code with one', async () => {
    const { container } = render(
      <MarkdownRenderer>{'说明：`npm test`\n\n```js\nconst a = 1\n```'}</MarkdownRenderer>
    )

    expect(await screen.findByText('npm test')).toBeTruthy()
    await waitFor(() => {
      expect(container.querySelector('code.hljs, code[class*="language-"]')).toBeTruthy()
    })
  })

  it('routes mermaid fences to the mermaid block through the default component', async () => {
    render(<MarkdownRenderer>{'```mermaid\ngraph TD; A-->B\n```'}</MarkdownRenderer>)
    const block = await screen.findByTestId('mermaid')
    expect(block.textContent).toContain('graph TD; A-->B')
  })
})

describe('ChatMessage markdown components', () => {
  it('renders fenced and inline code, and copies the code text', async () => {
    const view = render(
      <ChatMessage id="m1" role="assistant" content={'说明：`npm test`\n\n```js\nconst a = 1\n```'} />
    )

    expect(await screen.findByText('npm test')).toBeTruthy()
    const copy = await screen.findByLabelText('复制消息内容')

    fireEvent.click(copy)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const a = 1\n'))
    expect(await screen.findByText('已复制')).toBeTruthy()

    // A second click while the revert timer is pending resets it (no throw).
    fireEvent.click(copy)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))

    // Unmount with a pending timer — the cleanup effect clears it.
    view.unmount()
  })

  it('routes mermaid fences to the mermaid block', async () => {
    render(
      <ChatMessage id="m1" role="assistant" content={'```mermaid\ngraph TD; A-->B\n```'} />
    )
    const block = await screen.findByTestId('mermaid')
    expect(block.textContent).toContain('graph TD; A-->B')
  })

  it('leaves non-citation blockquotes untouched', async () => {
    render(<ChatMessage id="m1" role="assistant" content={'> 普通引用\n> 第二行'} />)
    expect(await screen.findByText(/普通引用/)).toBeTruthy()
    expect(screen.queryByLabelText('查看教材原文')).toBeNull()
  })

  it('handles blockquote children without text (hr inside)', async () => {
    render(<ChatMessage id="m1" role="assistant" content={'> ---\n> 分隔线后的引用'} />)
    expect(await screen.findByText('分隔线后的引用')).toBeTruthy()
    expect(screen.queryByLabelText('查看教材原文')).toBeNull()
  })
})

describe('ChatMessage citation chip', () => {
  const CITATION = '> 【教材出处 · 《高等数学》 · 第3章】\n> 引文内容'

  it('marks citations that are not found in the textbook', async () => {
    render(
      <ChatMessage
        id="m1"
        role="assistant"
        content={CITATION}
        textbookId="tb1"
        mismatchedCitations={new Set(['【教材出处 · 《高等数学》 · 第3章】'])}
      />
    )

    expect(await screen.findByText('⚠️ 未在教材中找到该引用，内容待核实')).toBeTruthy()
    expect(screen.getByText(/疑似不实的教材引用/)).toBeTruthy()
  })

  it('keeps citations unstyled when only other markers are flagged', async () => {
    render(
      <ChatMessage
        id="m1"
        role="assistant"
        content={CITATION}
        textbookId="tb1"
        mismatchedCitations={new Set(['【教材出处 · 《其他书》 · 第一章】'])}
      />
    )

    expect(await screen.findByText('📖 教材原文 · 第3章')).toBeTruthy()
    expect(screen.queryByText(/未在教材中找到该引用/)).toBeNull()
    expect(screen.queryByText(/疑似不实的教材引用/)).toBeNull()
  })

  it('loads the excerpt, toggles off, then loads the translation', async () => {
    const source = deferred<{ excerpt: string }>()
    searchExcerpt.mockReturnValue(source.promise)
    translateExcerpt.mockResolvedValue({ excerpt: '原文E', translation: '译文T' })

    render(<ChatMessage id="m1" role="assistant" content={CITATION} textbookId="tb1" />)

    const sourceBtn = await screen.findByText('📖 教材原文 · 第3章')
    const translateBtn = screen.getByText('🌐 翻译')
    expect(screen.getByTitle('查看教材原文')).toBeTruthy()
    expect(screen.getByTitle('把这段教材原文翻译成中文')).toBeTruthy()

    fireEvent.click(sourceBtn)
    expect(await screen.findByText('加载中...')).toBeTruthy()
    expect(searchExcerpt).toHaveBeenCalledWith('tb1', '第3章')

    source.resolve({ excerpt: '教材原文片段' })
    expect(await screen.findByText('教材原文片段')).toBeTruthy()

    // Clicking the same mode again closes the panel.
    fireEvent.click(sourceBtn)
    await waitFor(() => expect(screen.queryByText('教材原文片段')).toBeNull())

    fireEvent.click(translateBtn)
    expect(await screen.findByText('译文T')).toBeTruthy()
    expect(screen.getByText('原文E')).toBeTruthy()
    expect(translateExcerpt).toHaveBeenCalledWith('tb1', '第3章')
  })

  it('surfaces missing excerpts, missing translations and read failures', async () => {
    searchExcerpt.mockResolvedValueOnce(null)
    translateExcerpt.mockResolvedValueOnce(null)

    render(<ChatMessage id="m1" role="assistant" content={CITATION} textbookId="tb1" />)

    fireEvent.click(await screen.findByText('📖 教材原文 · 第3章'))
    expect(await screen.findByText('未在教材中找到对应章节')).toBeTruthy()

    fireEvent.click(screen.getByText('🌐 翻译'))
    expect(await screen.findByText('翻译不可用（可能未配置模型）')).toBeTruthy()

    searchExcerpt.mockRejectedValueOnce(new Error('ipc down'))
    fireEvent.click(screen.getByText('📖 教材原文 · 第3章'))
    expect(await screen.findByText('读取失败，请重试')).toBeTruthy()
  })

  it('disables both actions when the classroom has no textbook', async () => {
    render(<ChatMessage id="m1" role="assistant" content={CITATION} />)

    const [sourceBtn, translateBtn] = await screen.findAllByLabelText('未绑定教材')

    expect((sourceBtn as HTMLButtonElement).disabled).toBe(true)
    expect((translateBtn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByTitle('当前课堂未绑定教材')).toHaveLength(2)

    fireEvent.click(sourceBtn)
    expect(searchExcerpt).not.toHaveBeenCalled()
  })
})

describe('ChatMessage inline edit cancel', () => {
  it('invokes the rewind, regenerate and delete actions', async () => {
    const onRewind = vi.fn()
    const onRegenerate = vi.fn()
    const onDelete = vi.fn()
    render(
      <ChatMessage
        id="m1"
        role="assistant"
        content="你好"
        showActions
        onRewind={onRewind}
        onRegenerate={onRegenerate}
        onDelete={onDelete}
      />
    )

    fireEvent.click(await screen.findByLabelText('从这里重新开始'))
    fireEvent.click(screen.getByLabelText('重新生成回复'))
    fireEvent.click(screen.getByLabelText('删除消息'))

    expect(onRewind).toHaveBeenCalledWith('m1')
    expect(onRegenerate).toHaveBeenCalledWith('m1')
    expect(onDelete).toHaveBeenCalledWith('m1')
  })

  it('restores the original content when the edit is cancelled', async () => {
    render(<ChatMessage id="m1" role="user" content="原始内容" showActions onEdit={() => {}} />)

    fireEvent.click(screen.getByLabelText('编辑消息'))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '改动中' } })
    fireEvent.click(screen.getByText('取消'))

    expect(await screen.findByText('原始内容')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
