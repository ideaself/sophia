import { describe, it, expect, vi, afterEach } from 'vitest'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withTimeout, pipeToFileWithIdleTimeout } from '../../../src/main/sync/webdav-client'

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

describe('pipeToFileWithIdleTimeout', () => {
  it('writes the full stream to disk and resolves', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sophia-stream-'))
    try {
      const target = join(dir, 'out.bin')
      const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x80])
      await pipeToFileWithIdleTimeout(Readable.from(bytes), target, 5000, 'GET /x.pdf')
      expect((await readFile(target)).equals(bytes)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects when no data arrives within the idle window', async () => {
    vi.useFakeTimers()
    const dir = await mkdtemp(join(tmpdir(), 'sophia-stream-'))
    try {
      const target = join(dir, 'out.bin')
      const stalled = new Readable({ read() {} }) // never emits
      const assertion = expect(
        pipeToFileWithIdleTimeout(stalled, target, 5000, 'GET /big.pdf')
      ).rejects.toThrow(/idle.*GET \/big\.pdf/i)
      await vi.advanceTimersByTimeAsync(5001)
      await assertion
      stalled.destroy()
    } finally {
      vi.useRealTimers()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('survives gaps shorter than the idle window between chunks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sophia-stream-'))
    try {
      const target = join(dir, 'out.bin')
      // Emits a chunk every 100ms — under the 1000ms idle limit
      let sent = 0
      const slow = new Readable({
        read() {
          if (sent >= 5) {
            this.push(null)
            return
          }
          setTimeout(() => {
            sent++
            this.push(Buffer.from(`chunk${sent}`))
          }, 100)
        }
      })
      await pipeToFileWithIdleTimeout(slow, target, 1000, 'GET /slow.pdf')
      expect(await readFile(target, 'utf-8')).toBe('chunk1chunk2chunk3chunk4chunk5')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
