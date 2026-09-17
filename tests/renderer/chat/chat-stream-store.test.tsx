// @vitest-environment jsdom
/**
 * App-level stream store: the shell holding the controller must NOT re-render
 * per token; subscribers (the classroom) re-render — coalesced to one pass per
 * animation frame.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import {
  getChatStreamController,
  subscribeChatStream,
  useChatStreamTick,
  resetChatStreamStore
} from '../../../src/renderer/src/chat/chat-stream-store'

type TokenCb = (token: string) => void
type ThinkingCb = (text: string) => void
type EndCb = (reason: string) => void

const tokenCbs = new Map<string, TokenCb>()
const thinkingCbs = new Map<string, ThinkingCb>()
const endCbs = new Map<string, EndCb>()
const startStream = vi.fn(async () => 'sess-1')
const cancelStream = vi.fn(async () => {})

beforeEach(() => {
  tokenCbs.clear()
  thinkingCbs.clear()
  endCbs.clear()
  startStream.mockClear()
  cancelStream.mockClear()
  resetChatStreamStore()

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: {
      chat: {
        startStream,
        cancelStream,
        onToken: (sid: string, cb: TokenCb) => {
          tokenCbs.set(sid, cb)
          return () => tokenCbs.delete(sid)
        },
        onThinking: (sid: string, cb: ThinkingCb) => {
          thinkingCbs.set(sid, cb)
          return () => thinkingCbs.delete(sid)
        },
        onError: () => () => {},
        onEnd: (sid: string, cb: EndCb) => {
          endCbs.set(sid, cb)
          return () => endCbs.delete(sid)
        },
        onUsage: () => () => {}
      }
    }
  })
})

afterEach(() => {
  cleanup()
  resetChatStreamStore()
})

/** Let the frame coalescer flush (rAF or its ~16ms timer fallback). */
async function flushFrame(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 32))
}

describe('chat-stream-store', () => {
  it('creates one controller for the app, wired to window.sophia.chat', async () => {
    const controller = getChatStreamController()

    expect(getChatStreamController()).toBe(controller)
    await act(async () => {
      await controller.send([{ role: 'user', content: '你好' }])
    })
    expect(startStream).toHaveBeenCalledTimes(1)
  })

  it('keeps the shell from re-rendering per token while subscribers update', async () => {
    let shellRenders = 0
    let childRenders = 0

    function Child(): React.ReactElement {
      useChatStreamTick()
      childRenders += 1
      const controller = getChatStreamController()
      return <div data-testid="content">{controller.state.assistantContent || 'idle'}</div>
    }

    function Shell(): React.ReactElement {
      shellRenders += 1
      getChatStreamController()
      return <Child />
    }

    render(<Shell />)
    expect(shellRenders).toBe(1)
    expect(screen.getByTestId('content').textContent).toBe('idle')

    const controller = getChatStreamController()
    await act(async () => {
      await controller.send([{ role: 'user', content: '问题' }])
      tokenCbs.get('sess-1')!('Hello')
      await flushFrame()
    })

    expect(screen.getByTestId('content').textContent).toBe('Hello')
    expect(childRenders).toBeGreaterThan(1)
    // The shell holds the stable controller without subscribing.
    expect(shellRenders).toBe(1)
  })

  it('coalesces a token burst into a single notification per frame', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeChatStream(listener)
    const controller = getChatStreamController()

    await act(async () => {
      await controller.send([{ role: 'user', content: '问题' }])
    })
    listener.mockClear()

    await act(async () => {
      const cb = tokenCbs.get('sess-1')!
      cb('a')
      cb('b')
      cb('c')
      await flushFrame()
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(controller.state.assistantContent).toBe('abc')

    unsubscribe()
    await act(async () => {
      tokenCbs.get('sess-1')!('d')
      await flushFrame()
    })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('useChatStream hook wrapper', () => {
  it('returns the shared controller and survives a stream tick', async () => {
    const { renderHook, act } = await import('@testing-library/react')
    const { useChatStream } = await import('../../../src/renderer/src/chat/useChatStream')

    const hook = renderHook(() => useChatStream())
    const controller = getChatStreamController()
    expect(hook.result.current).toBe(controller)

    await act(async () => {
      await controller.send([{ role: 'user', content: 'hi' }], 'deepseek-v4-flash')
    })
    expect(hook.result.current).toBe(controller)
  })
})
