// @vitest-environment jsdom
/**
 * useMessageListScroll — stick-to-bottom anchor contract.
 *
 * jsdom lacks layout, so the scroll container's scrollTop/scrollHeight/
 * clientHeight are backed by a controllable store per test; the virtualizer
 * needs the same ResizeObserver + offset stubs the ClassroomView suite uses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import {
  useMessageListScroll,
  type ScrollRow
} from '../../../src/renderer/src/chat/useMessageListScroll'

// --------------- jsdom layout stubs ---------------

class FakeResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.cb(
      [{ target, contentRect: { width: 800, height: 600, top: 0, left: 0, bottom: 600, right: 800, x: 0, y: 0 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver
    )
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  Element.prototype.scrollTo = (() => {}) as never
  Element.prototype.scrollIntoView = (() => {}) as never
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// --------------- harness ---------------

interface HarnessProps {
  rows: ScrollRow[]
  messages: unknown[]
  streamContent?: string
  streaming?: boolean
  activeIdx?: number
  searchOpen?: boolean
  searchMatches?: readonly number[]
  matchIndex?: number
}

function Harness({
  rows,
  messages,
  streamContent = '',
  streaming = false,
  activeIdx = 0,
  searchOpen = false,
  searchMatches = EMPTY_MATCHES,
  matchIndex = 0
}: HarnessProps): React.ReactElement {
  const { scrollRef, stickToBottom, handleScroll } = useMessageListScroll({
    rows,
    messages,
    streamContent,
    streaming,
    activeIdx,
    searchOpen,
    searchMatches,
    matchIndex
  })
  return (
    <>
      <div data-testid="stick">{stickToBottom ? 'pinned' : 'free'}</div>
      <div data-testid="list" ref={scrollRef} onScroll={handleScroll} />
    </>
  )
}

const EMPTY_MATCHES: readonly number[] = []
const MATCHES_ONE: readonly number[] = [0]

function rowsOf(...keys: string[]): ScrollRow[] {
  return keys.map((key) => ({ key }))
}

interface Geometry {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
  writes: number[]
}

/** Controllable scroll geometry: jsdom reports zeros otherwise. */
function stubGeometry(el: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop = 0): Geometry {
  const geo: Geometry = { scrollHeight, clientHeight, scrollTop, writes: [] }
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => geo.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => geo.clientHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => geo.scrollTop,
    set: (v: number) => geo.writes.push(v)
  })
  return geo
}

// --------------- tests ---------------

describe('useMessageListScroll', () => {
  it('follows new messages to the real bottom while pinned', () => {
    const { rerender } = render(<Harness rows={rowsOf('a')} messages={[{ id: 'a' }]} />)
    const geo = stubGeometry(screen.getByTestId('list'), 1000, 100, 950)

    rerender(<Harness rows={rowsOf('a', 'b')} messages={[{ id: 'a' }, { id: 'b' }]} />)

    expect(screen.getByTestId('stick').textContent).toBe('pinned')
    expect(geo.writes).toContain(1000)
  })

  it('stops following after the user scrolls up, and follows again at the bottom', () => {
    const { rerender } = render(<Harness rows={rowsOf('a')} messages={[{ id: 'a' }]} />)
    const list = screen.getByTestId('list')
    const geo = stubGeometry(list, 1000, 100, 900)

    geo.scrollTop = 100
    fireEvent.scroll(list)
    expect(screen.getByTestId('stick').textContent).toBe('free')

    geo.writes.length = 0
    rerender(<Harness rows={rowsOf('a', 'b')} messages={[{ id: 'a' }, { id: 'b' }]} />)
    expect(geo.writes).toEqual([])

    geo.scrollTop = 950
    fireEvent.scroll(list)
    expect(screen.getByTestId('stick').textContent).toBe('pinned')

    geo.writes.length = 0
    rerender(<Harness rows={rowsOf('a', 'b', 'c')} messages={[{ id: 'a' }, { id: 'b' }, { id: 'c' }]} />)
    expect(geo.writes).toContain(1000)
  })

  it('resets the anchor when the active tab changes', () => {
    const { rerender } = render(<Harness rows={rowsOf('a')} messages={[{ id: 'a' }]} />)
    const list = screen.getByTestId('list')
    const geo = stubGeometry(list, 1000, 100, 900)

    geo.scrollTop = 100
    fireEvent.scroll(list)
    expect(screen.getByTestId('stick').textContent).toBe('free')

    rerender(<Harness rows={rowsOf('a')} messages={[{ id: 'a' }]} activeIdx={1} />)
    expect(screen.getByTestId('stick').textContent).toBe('pinned')
  })

  it('re-evaluates the anchor from the real position when the search closes', () => {
    const { rerender } = render(
      <Harness rows={rowsOf('a')} messages={[{ id: 'a' }]} searchOpen searchMatches={MATCHES_ONE} />
    )
    const geo = stubGeometry(screen.getByTestId('list'), 1000, 100, 950)

    // Match navigation leaves the viewport away from the bottom.
    expect(screen.getByTestId('stick').textContent).toBe('free')

    geo.scrollTop = 100
    rerender(
      <Harness rows={rowsOf('a')} messages={[{ id: 'a' }]} searchMatches={MATCHES_ONE} />
    )
    expect(screen.getByTestId('stick').textContent).toBe('free')

    geo.scrollTop = 950
    rerender(
      <Harness rows={rowsOf('a')} messages={[{ id: 'a' }]} searchOpen searchMatches={MATCHES_ONE} />
    )
    rerender(
      <Harness rows={rowsOf('a')} messages={[{ id: 'a' }]} searchMatches={MATCHES_ONE} />
    )
    expect(screen.getByTestId('stick').textContent).toBe('pinned')
  })

  it('pins to the bottom when a stream starts', () => {
    const { rerender } = render(<Harness rows={rowsOf('a')} messages={[{ id: 'a' }]} streaming={false} />)
    const list = screen.getByTestId('list')
    const geo = stubGeometry(list, 1000, 100, 900)

    geo.scrollTop = 100
    fireEvent.scroll(list)
    expect(screen.getByTestId('stick').textContent).toBe('free')

    rerender(<Harness rows={rowsOf('a')} messages={[{ id: 'a' }]} streaming />)
    expect(screen.getByTestId('stick').textContent).toBe('pinned')
  })

  it('keeps the empty list untouched', () => {
    render(<Harness rows={[]} messages={[]} />)
    const geo = stubGeometry(screen.getByTestId('list'), 1000, 100, 950)

    expect(geo.writes).toEqual([])
    expect(screen.getByTestId('stick').textContent).toBe('pinned')
  })
})
