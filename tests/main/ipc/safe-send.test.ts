import { describe, it, expect, vi, afterEach } from 'vitest'
import type { WebContents } from 'electron'

import { safeSend } from '../../../src/main/ipc/safe-send'

function mockWebContents(overrides: Partial<{ destroyed: boolean; sendThrow: boolean }> = {}): {
  wc: WebContents
  send: ReturnType<typeof vi.fn>
} {
  const send = vi.fn(() => {
    if (overrides.sendThrow) throw new Error('Object has been destroyed')
  })
  const wc = {
    isDestroyed: () => overrides.destroyed ?? false,
    send
  } as unknown as WebContents
  return { wc, send }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('safeSend', () => {
  it('sends on a live webContents', () => {
    const { wc, send } = mockWebContents()
    safeSend(wc, 'test:channel', { ok: true })
    expect(send).toHaveBeenCalledWith('test:channel', { ok: true })
  })

  it('does not send to a destroyed webContents', () => {
    const { wc, send } = mockWebContents({ destroyed: true })
    safeSend(wc, 'test:channel', { ok: true })
    expect(send).not.toHaveBeenCalled()
  })

  it('swallows send failures instead of throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wc, send } = mockWebContents({ sendThrow: true })

    expect(() => safeSend(wc, 'test:channel', { ok: true })).not.toThrow()
    expect(send).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('test:channel'),
      expect.stringContaining('destroyed')
    )
  })
})
