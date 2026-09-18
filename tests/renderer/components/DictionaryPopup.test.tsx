// @vitest-environment jsdom
/**
 * DictionaryPopup — URL building, webview load states, zoom controls with
 * persisted prefs, resize handle and close semantics.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DictionaryPopup } from '../../../src/renderer/src/components/DictionaryPopup'
import { DEFAULT_DICT_POPUP_PREFS } from '../../../src/shared/dict'

const appApi = { openExternal: vi.fn(async () => ({ success: true })) }

beforeEach(() => {
  localStorage.clear()
  appApi.openExternal.mockClear()
  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { app: appApi }
  })
})

afterEach(cleanup)

function webviewEl(): HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> } {
  const el = document.querySelector('webview')
  if (!el) throw new Error('webview not rendered')
  return el as HTMLElement
}

function fireWebview(event: string): void {
  webviewEl().dispatchEvent(new Event(event))
}

function popupEl(): HTMLElement {
  const el = document.querySelector('.fixed.z-40')
  if (!el) throw new Error('popup root not rendered')
  return el as HTMLElement
}

describe('DictionaryPopup — rendering and load states', () => {
  it('builds the dictionary URL for the word and shows the loading overlay', () => {
    render(<DictionaryPopup word="entropy" onClose={vi.fn()} />)

    expect(screen.getByText('📖 entropy')).toBeTruthy()
    expect(screen.getByText('词典加载中...')).toBeTruthy()
    expect(webviewEl().getAttribute('src')).toBe(
      'https://dict.youdao.com/result?word=entropy&lang=en'
    )
    expect(webviewEl().getAttribute('webpreferences')).toContain('sandbox=yes')
    expect(webviewEl().style.visibility).toBe('hidden')
  })

  it('honours a custom template from settings', () => {
    localStorage.setItem('sophia.dictEnabled', '1')
    localStorage.setItem('sophia.dictTemplate', 'https://dict.example/w/{word}')
    render(<DictionaryPopup word="熵" onClose={vi.fn()} />)

    expect(webviewEl().getAttribute('src')).toBe('https://dict.example/w/%E7%86%B5')
  })

  it('becomes ready on dom-ready and applies the stored zoom once', async () => {
    render(<DictionaryPopup word="entropy" onClose={vi.fn()} />)
    const executeJavaScript = vi.fn(async () => {})
    webviewEl().executeJavaScript = executeJavaScript

    fireWebview('dom-ready')

    await waitFor(() => expect(screen.queryByText('词典加载中...')).toBeNull())
    expect(webviewEl().style.visibility).toBe('visible')
    expect(executeJavaScript).toHaveBeenCalledWith(
      `document.documentElement.style.zoom = ${DEFAULT_DICT_POPUP_PREFS.zoom.toFixed(2)}`
    )
  })

  it('shows the failure state with a browser fallback', async () => {
    const onClose = vi.fn()
    render(<DictionaryPopup word="entropy" onClose={onClose} />)

    fireWebview('did-fail-load')

    expect(await screen.findByText('词典页面加载失败。')).toBeTruthy()
    fireEvent.click(screen.getByText('在新窗口打开词典'))

    expect(appApi.openExternal).toHaveBeenCalledWith(
      'https://dict.youdao.com/result?word=entropy&lang=en'
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('rebuilds the URL and resets the load state when the word changes', async () => {
    const { rerender } = render(<DictionaryPopup word="entropy" onClose={vi.fn()} />)
    fireWebview('dom-ready')
    await waitFor(() => expect(screen.queryByText('词典加载中...')).toBeNull())

    rerender(<DictionaryPopup word="enthalpy" onClose={vi.fn()} />)

    expect(webviewEl().getAttribute('src')).toContain('enthalpy')
    expect(screen.getByText('📖 enthalpy')).toBeTruthy()
    expect(screen.getByText('词典加载中...')).toBeTruthy()
  })
})

describe('DictionaryPopup — zoom', () => {
  it('disables zoom until ready, then steps and persists', async () => {
    render(<DictionaryPopup word="entropy" onClose={vi.fn()} />)
    const zoomOut = screen.getByTitle('缩小') as HTMLButtonElement
    const zoomIn = screen.getByTitle('放大') as HTMLButtonElement
    expect(zoomOut.disabled).toBe(true)
    expect(zoomIn.disabled).toBe(true)

    webviewEl().executeJavaScript = vi.fn(async () => {})
    fireWebview('dom-ready')
    await waitFor(() => expect(zoomIn.disabled).toBe(false))

    fireEvent.click(zoomIn)
    expect(screen.getByText('100%')).toBeTruthy()

    fireEvent.click(zoomOut)
    expect(screen.getByText('90%')).toBeTruthy()

    const prefs = JSON.parse(localStorage.getItem('sophia.dictPopupPrefs') ?? '{}')
    expect(prefs.zoom).toBeCloseTo(0.9)
  })

  it('clamps the zoom to the allowed range', async () => {
    render(<DictionaryPopup word="entropy" onClose={vi.fn()} />)
    webviewEl().executeJavaScript = vi.fn(async () => {})
    fireWebview('dom-ready')
    // Default popup zoom is 0.85.
    await waitFor(() => expect(screen.getByText('85%')).toBeTruthy())

    for (let i = 0; i < 12; i++) fireEvent.click(screen.getByTitle('放大'))
    expect(screen.getByText('150%')).toBeTruthy()

    for (let i = 0; i < 15; i++) fireEvent.click(screen.getByTitle('缩小'))
    expect(screen.getByText('50%')).toBeTruthy()
  })

  it('keeps a user-adjusted zoom when the page becomes ready again', async () => {
    render(<DictionaryPopup word="entropy" onClose={vi.fn()} />)
    const executeJavaScript = vi.fn(async () => {})
    webviewEl().executeJavaScript = executeJavaScript
    fireWebview('dom-ready')
    await waitFor(() => expect(screen.getByText('85%')).toBeTruthy())

    fireEvent.click(screen.getByTitle('放大'))
    expect(executeJavaScript).toHaveBeenCalledWith('document.documentElement.style.zoom = 1.00')
    executeJavaScript.mockClear()

    // A second dom-ready (e.g. an internal navigation) must not reset the zoom.
    fireWebview('dom-ready')
    await waitFor(() => expect(screen.getByText('100%')).toBeTruthy())
    expect(executeJavaScript).not.toHaveBeenCalled()
  })
})

describe('DictionaryPopup — resize', () => {
  it('resizes from the handle, clamps to the minimum and persists', async () => {
    render(<DictionaryPopup word="entropy" onClose={vi.fn()} />)
    const root = popupEl()
    expect(root.style.width).toBe(`${DEFAULT_DICT_POPUP_PREFS.width}px`)

    const handle = screen.getByTitle('拖动调整大小')
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 160, clientY: 150 })
    expect(root.style.width).toBe('700px')
    expect(root.style.height).toBe('530px')

    // Dragging far left/up clamps to the minimum size.
    fireEvent.mouseMove(document, { clientX: -500, clientY: -500 })
    expect(root.style.width).toBe('420px')
    expect(root.style.height).toBe('320px')

    fireEvent.mouseUp(document)
    const prefs = JSON.parse(localStorage.getItem('sophia.dictPopupPrefs') ?? '{}')
    expect(prefs).toMatchObject({ width: 420, height: 320 })
  })
})

describe('DictionaryPopup — closing', () => {
  it('closes on Escape, outside clicks and the close button', () => {
    const onClose = vi.fn()
    render(<DictionaryPopup word="entropy" onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.mouseDown(popupEl())
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByTitle('关闭 (Esc)'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('opens the page in the system browser and closes', () => {
    const onClose = vi.fn()
    render(<DictionaryPopup word="entropy" onClose={onClose} />)

    fireEvent.click(screen.getByTitle('在系统浏览器中打开词典'))

    expect(appApi.openExternal).toHaveBeenCalledWith(
      'https://dict.youdao.com/result?word=entropy&lang=en'
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('ignores other keys while open', () => {
    const onClose = vi.fn()
    render(<DictionaryPopup word="entropy" onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'a' })

    expect(onClose).not.toHaveBeenCalled()
  })
})
