import { describe, it, expect, vi, afterEach } from 'vitest'

import { createFrameCoalescer } from '../../src/shared/frame-coalescer'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createFrameCoalescer', () => {
  it('collapses a burst of schedule() calls into a single flush', async () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const coalescer = createFrameCoalescer(flush)

    for (let i = 0; i < 100; i++) coalescer.schedule()
    expect(flush).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(20)
    expect(flush).toHaveBeenCalledTimes(1)

    // A later burst flushes again.
    coalescer.schedule()
    await vi.advanceTimersByTimeAsync(20)
    expect(flush).toHaveBeenCalledTimes(2)
    coalescer.dispose()
  })

  it('ignores schedule() after dispose() and cancels a pending flush', async () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const coalescer = createFrameCoalescer(flush)

    coalescer.schedule()
    coalescer.dispose()
    await vi.advanceTimersByTimeAsync(50)
    expect(flush).not.toHaveBeenCalled()

    // Disposed coalescer never flushes again (unmounted component).
    coalescer.schedule()
    await vi.advanceTimersByTimeAsync(50)
    expect(flush).not.toHaveBeenCalled()
  })

  it('does not flush when a pending frame callback fires after dispose', () => {
    const flush = vi.fn()
    let captured: (() => void) | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      captured = cb
      return 1
    })
    // Simulate a cancellation that did not prevent the already-queued callback.
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const coalescer = createFrameCoalescer(flush)
    coalescer.schedule()
    coalescer.dispose()
    captured!()

    expect(flush).not.toHaveBeenCalled()
  })
})
