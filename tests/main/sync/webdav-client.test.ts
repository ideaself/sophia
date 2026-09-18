import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  withTimeout,
  pipeToFileWithIdleTimeout,
  isRemoteNotFoundError,
  SyncWebDavClient
} from '../../../src/main/sync/webdav-client'

const webdavMock = vi.hoisted(() => ({
  client: {
    getDirectoryContents: vi.fn(),
    putFileContents: vi.fn(),
    getFileContents: vi.fn(),
    createReadStream: vi.fn(),
    exists: vi.fn(),
    createDirectory: vi.fn(),
    deleteFile: vi.fn(),
    moveFile: vi.fn()
  }
}))

vi.mock('webdav', () => ({
  createClient: () => webdavMock.client
}))

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

describe('isRemoteNotFoundError', () => {
  it('detects 404 statuses only', () => {
    expect(isRemoteNotFoundError({ status: 404 })).toBe(true)
    expect(isRemoteNotFoundError({ status: 500 })).toBe(false)
    expect(isRemoteNotFoundError(new Error('boom'))).toBe(false)
    expect(isRemoteNotFoundError(null)).toBe(false)
    expect(isRemoteNotFoundError('404')).toBe(false)
  })
})

describe('SyncWebDavClient', () => {
  const entries = [
    { basename: '', filename: '/sophia/', type: 'directory', size: 0, lastmod: '' },
    { basename: 'a.md', filename: '/sophia/a.md', type: 'file', size: 12, lastmod: '2026-09-16T00:00:00Z' },
    { basename: 'sub', filename: '/sophia/sub', type: 'directory', size: 0, lastmod: '' }
  ]

  function makeClient(): SyncWebDavClient {
    return new SyncWebDavClient({ url: 'https://dav.example/dav', username: 'u', password: 'p' })
  }

  beforeEach(() => {
    for (const fn of Object.values(webdavMock.client)) fn.mockReset()
  })

  it('test() reports success and maps failures', async () => {
    webdavMock.client.getDirectoryContents.mockResolvedValue([])
    await expect(makeClient().test()).resolves.toEqual({
      success: true,
      message: 'Connected successfully'
    })

    webdavMock.client.getDirectoryContents.mockRejectedValue(new Error('auth failed'))
    await expect(makeClient().test()).resolves.toEqual({ success: false, message: 'auth failed' })

    webdavMock.client.getDirectoryContents.mockRejectedValue('nope')
    await expect(makeClient().test()).resolves.toEqual({
      success: false,
      message: 'Connection failed'
    })
  })

  it('listFiles skips the self entry and maps directories', async () => {
    webdavMock.client.getDirectoryContents.mockResolvedValue(entries)
    await expect(makeClient().listFiles('/sophia')).resolves.toEqual([
      { path: '/sophia/a.md', isDir: false },
      { path: '/sophia/sub', isDir: true }
    ])
  })

  it('listFiles treats a 404 as empty but rethrows other errors', async () => {
    webdavMock.client.getDirectoryContents.mockRejectedValue({ status: 404 })
    await expect(makeClient().listFiles('/missing')).resolves.toEqual([])

    webdavMock.client.getDirectoryContents.mockRejectedValue({ status: 500 })
    await expect(makeClient().listFiles('/broken')).rejects.toEqual({ status: 500 })
  })

  it('walks remote trees recursively and tolerates 404s', async () => {
    webdavMock.client.getDirectoryContents.mockImplementation(async (dir: string) => {
      if (dir === '/sophia/sub') {
        return [{ basename: 'b.md', filename: '/sophia/sub/b.md', type: 'file', size: 3, lastmod: 'x' }]
      }
      if (dir === '/missing') throw { status: 404 }
      return entries
    })

    await expect(makeClient().listAllFiles('/sophia')).resolves.toEqual([
      '/sophia/a.md',
      '/sophia/sub/b.md'
    ])
    await expect(makeClient().listAllFiles('/missing')).resolves.toEqual([])

    const detailed = await makeClient().listAllFilesDetailed('/sophia')
    expect(detailed.map((f) => f.path).sort()).toEqual(['/sophia/a.md', '/sophia/sub/b.md'])
    expect(detailed.find((f) => f.path === '/sophia/a.md')).toMatchObject({ size: 12 })
  })

  it('downloads text, buffers and streams to disk', async () => {
    webdavMock.client.getFileContents.mockResolvedValueOnce('hello')
    await expect(makeClient().downloadFile('/a.md')).resolves.toBe('hello')

    webdavMock.client.getFileContents.mockResolvedValueOnce(
      new TextEncoder().encode('bytes').buffer
    )
    await expect(makeClient().downloadFile('/b.md')).resolves.toBe('bytes')

    webdavMock.client.getFileContents.mockResolvedValueOnce(Buffer.from('binary'))
    await expect(makeClient().downloadFileBuffer('/c.pdf')).resolves.toEqual(Buffer.from('binary'))

    webdavMock.client.getFileContents.mockResolvedValueOnce('not-a-buffer')
    await expect(makeClient().downloadFileBuffer('/d.pdf')).resolves.toEqual(
      Buffer.from('not-a-buffer')
    )

    const dir = await mkdtemp(join(tmpdir(), 'sophia-dav-'))
    try {
      webdavMock.client.createReadStream.mockReturnValue(Readable.from(Buffer.from('streamed')))
      const target = join(dir, 'x.bin')
      await makeClient().downloadToFile('/x.bin', target)
      expect(await readFile(target, 'utf-8')).toBe('streamed')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uploads strings and streams, ensures dirs, deletes and moves', async () => {
    const c = makeClient()
    webdavMock.client.putFileContents.mockResolvedValue(undefined)
    webdavMock.client.exists.mockResolvedValue(true)

    await c.uploadFile('/sophia/a.md', 'content')
    expect(webdavMock.client.putFileContents).toHaveBeenCalledWith('/sophia/a.md', 'content', {
      overwrite: true
    })

    await c.uploadFile('/sophia/big.bin', Readable.from(Buffer.from('x')))
    expect(webdavMock.client.putFileContents).toHaveBeenCalledTimes(2)

    await c.ensureDir('/sophia/sub')
    expect(webdavMock.client.createDirectory).not.toHaveBeenCalled()

    webdavMock.client.exists.mockResolvedValue(false)
    await c.ensureDir('/sophia/new')
    expect(webdavMock.client.createDirectory).toHaveBeenCalledWith('/sophia/new', { recursive: true })

    webdavMock.client.exists.mockRejectedValue(new Error('boom'))
    await expect(c.ensureDir('/sophia/err')).resolves.toBeUndefined()

    webdavMock.client.deleteFile.mockResolvedValue(undefined)
    await c.deleteFile('/sophia/a.md')
    expect(webdavMock.client.deleteFile).toHaveBeenCalledWith('/sophia/a.md')

    webdavMock.client.moveFile.mockResolvedValue(undefined)
    await c.moveFile('/sophia/a.md', '/trash/a.md')
    expect(webdavMock.client.moveFile).toHaveBeenCalledWith('/sophia/a.md', '/trash/a.md', {
      overwrite: true
    })
  })
})

describe('pipeToFileWithIdleTimeout — stream failures', () => {
  it('rejects and closes the writer when the source stream errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sophia-stream-'))
    try {
      const target = join(dir, 'out.bin')
      const failing = new Readable({
        read() {
          this.push(Buffer.from('partial'))
          this.destroy(new Error('read exploded'))
        }
      })

      await expect(
        pipeToFileWithIdleTimeout(failing, target, 5000, 'GET /x.pdf')
      ).rejects.toThrow('read exploded')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects and closes the reader when the writer errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sophia-stream-'))
    try {
      // A directory as the target makes createWriteStream fail to open.
      const target = join(dir, 'as-dir')
      await mkdir(target, { recursive: true })

      await expect(
        pipeToFileWithIdleTimeout(Readable.from([Buffer.from('x')]), target, 5000, 'GET /y.pdf')
      ).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('SyncWebDavClient — walk error propagation', () => {
  it('rethrows non-404 errors while walking recursively', async () => {
    const client = new SyncWebDavClient({
      url: 'https://dav.example/dav',
      username: 'u',
      password: 'p'
    })

    webdavMock.client.getDirectoryContents.mockRejectedValueOnce({ status: 500 })
    await expect(client.listAllFiles('/sophia')).rejects.toMatchObject({ status: 500 })

    webdavMock.client.getDirectoryContents.mockRejectedValueOnce({ status: 500 })
    await expect(client.listAllFilesDetailed('/sophia')).rejects.toMatchObject({
      status: 500
    })
  })
})
