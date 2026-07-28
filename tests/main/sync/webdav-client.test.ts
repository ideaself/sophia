import { describe, it, expect, vi, afterEach } from 'vitest'
import { withTimeout } from '../../../src/main/sync/webdav-client'

afterEach(() => {
  vi.useRealTimers()
})

describe('withTimeout', () => {
  it('resolves with the underlying value', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'op')).resolves.toBe('ok')
  })

  it('rejects with the underlying error when it rejects first', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 1000, 'op')
    ).rejects.toThrow('boom')
  })

  it('rejects with a timeout error when the promise never settles', async () => {
    vi.useFakeTimers()
    const never = new Promise<string>(() => {})
    const guarded = withTimeout(never, 5000, 'GET /sophia/big.pdf')
    const assertion = expect(guarded).rejects.toThrow(/timed out.*GET \/sophia\/big\.pdf/)
    await vi.advanceTimersByTimeAsync(5001)
    await assertion
  })
})
