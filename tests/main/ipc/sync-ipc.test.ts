/**
 * sync.ts IPC — WebDAV config resolution (password never travels over IPC),
 * progress forwarding, timestamp stamping and trash operations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = (event: unknown, input?: unknown) => Promise<unknown>

/* eslint-disable @typescript-eslint/no-explicit-any */
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  managers: [] as any[],
  stores: [] as any[],
  constructorArgs: [] as unknown[][]
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      mocks.handlers.set(channel, fn)
    }
  }
}))

vi.mock('../../../src/main/sync/sync-manager', () => ({
  SyncManager: class {
    dataRoot: string
    constructor(dataRoot: string) {
      this.dataRoot = dataRoot
      mocks.managers.push(this)
    }
    test = vi.fn(async (cfg: unknown) => ({ success: true, cfg }))
    planPush = vi.fn(async (cfg: unknown) => ({ success: true, direction: 'push', cfg }))
    planPull = vi.fn(async (cfg: unknown) => ({ success: true, direction: 'pull', cfg }))
    push = vi.fn(async (cfg: unknown, onProgress: (p: unknown) => void) => {
      onProgress({ phase: 'upload', current: 1, total: 2 })
      return { success: true, pushed: 2 }
    })
    pull = vi.fn(async (cfg: unknown, onProgress: (p: unknown) => void) => {
      onProgress({ phase: 'download', current: 1, total: 1 })
      return { success: false, error: 'remote offline' }
    })
    listRemoteTrash = vi.fn(async () => [{ name: 'a', size: 1 }])
    emptyRemoteTrash = vi.fn(async () => ({ success: true, removed: 1 }))
  }
}))

vi.mock('../../../src/main/security/secure-key-store', () => ({
  SecureKeyStore: class {
    dataRoot: string
    file: string
    constructor(dataRoot: string, _safeStorage: unknown, file: string) {
      this.dataRoot = dataRoot
      this.file = file
      mocks.stores.push(this)
      mocks.constructorArgs.push([dataRoot, file])
    }
    readKey = vi.fn(async () => this.storedKey ?? null)
    hasKey = vi.fn(async () => Boolean(this.storedKey))
    setKey = vi.fn(async (key: string) => {
      this.storedKey = key
      return true
    })
    storedKey: string | null = 'secret-pass'
  }
}))

import { registerSyncIpc } from '../../../src/main/ipc/sync'

const CONFIG = { url: 'https://dav.example.com/sophia', username: 'me' }
const safeStorage = {
  isEncryptionAvailable: (): boolean => true,
  encryptString: (plaintext: string): Buffer => Buffer.from(plaintext),
  decryptString: (encrypted: Buffer): string => encrypted.toString('utf-8')
}

async function invoke<T = any>(channel: string, input?: unknown): Promise<T> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return (await handler(event as never, input)) as T
}

const sent: Array<[string, unknown]> = []
const event = {
  sender: {
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => sent.push([channel, payload])
  }
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.managers.length = 0
  mocks.stores.length = 0
  mocks.constructorArgs.length = 0
  sent.length = 0
  registerSyncIpc('C:\\data-root', safeStorage)
})

describe('sync IPC — password store', () => {
  it('reports and stores the password in the main process only', async () => {
    await expect(invoke('sync:has-webdav-password')).resolves.toBe(true)

    const store = mocks.stores[0]
    store.storedKey = null
    await expect(invoke('sync:has-webdav-password')).resolves.toBe(false)

    await expect(invoke('sync:set-webdav-password', { password: 'new-pass' })).resolves.toBeUndefined()
    expect(store.setKey).toHaveBeenCalledWith('new-pass')
    expect(store.storedKey).toBe('new-pass')

    await expect(invoke('sync:set-webdav-password', { password: '' })).rejects.toThrow()
    await expect(invoke('sync:set-webdav-password', {})).rejects.toThrow()
  })

  it('wires the data root into the manager and the password file name', () => {
    expect(mocks.managers[0].dataRoot).toBe('C:\\data-root')
    expect(mocks.constructorArgs[0]).toEqual(['C:\\data-root', 'webdav-password.enc'])
  })
})

describe('sync IPC — config resolution', () => {
  it('injects the stored password into the manager config', async () => {
    const result = await invoke('sync:test', CONFIG)
    expect(result).toMatchObject({
      success: true,
      cfg: { url: CONFIG.url, username: CONFIG.username, password: 'secret-pass' }
    })

    await invoke('sync:plan-push', CONFIG)
    await invoke('sync:plan-pull', CONFIG)
    expect(mocks.managers[0].planPush).toHaveBeenCalledWith({
      ...CONFIG,
      password: 'secret-pass'
    })
    expect(mocks.managers[0].planPull).toHaveBeenCalledWith({
      ...CONFIG,
      password: 'secret-pass'
    })
  })

  it('rejects when no password was stored yet', async () => {
    mocks.stores[0].storedKey = null
    await expect(invoke('sync:test', CONFIG)).rejects.toThrow('WebDAV password not set')
    await expect(invoke('sync:push', CONFIG)).rejects.toThrow('WebDAV password not set')
  })

  it('validates the renderer config payload', async () => {
    await expect(invoke('sync:test', { username: 'me' })).rejects.toThrow()
    await expect(invoke('sync:test', { url: 'https://x', username: '' })).rejects.toThrow()

    const trimmed = await invoke('sync:test', { url: '  https://x  ', username: '  me  ' })
    expect(trimmed.cfg).toMatchObject({ url: 'https://x', username: 'me' })
  })
})

describe('sync IPC — transfers', () => {
  it('forwards progress and stamps successful pushes', async () => {
    const result = await invoke('sync:push', CONFIG)

    expect(sent).toEqual([['sync:progress', { phase: 'upload', current: 1, total: 2 }]])
    expect(result.success).toBe(true)
    expect(Date.parse(result.timestamp)).not.toBeNaN()
  })

  it('returns failures untouched and still forwards progress', async () => {
    const result = await invoke('sync:pull', CONFIG)

    expect(sent).toEqual([['sync:progress', { phase: 'download', current: 1, total: 1 }]])
    expect(result).toEqual({ success: false, error: 'remote offline' })
    expect(result.timestamp).toBeUndefined()
  })

  it('omits the timestamp for failed pushes and adds it for successful pulls', async () => {
    mocks.managers[0].push.mockResolvedValueOnce({ success: false, error: 'disk full' })
    await expect(invoke('sync:push', CONFIG)).resolves.toEqual({ success: false, error: 'disk full' })

    mocks.managers[0].pull.mockResolvedValueOnce({ success: true, pulled: 3 })
    const pulled = await invoke('sync:pull', CONFIG)
    expect(pulled.success).toBe(true)
    expect(Date.parse(pulled.timestamp)).not.toBeNaN()
  })

  it('skips progress sends for destroyed renderers', async () => {
    const handler = mocks.handlers.get('sync:push')!
    const dead = { sender: { isDestroyed: () => true, send: vi.fn() } }
    await handler(dead, CONFIG)
    expect(dead.sender.send).not.toHaveBeenCalled()
  })

  it('skips pull progress sends for destroyed renderers', async () => {
    const handler = mocks.handlers.get('sync:pull')!
    const dead = { sender: { isDestroyed: () => true, send: vi.fn() } }
    await expect(handler(dead, CONFIG)).resolves.toMatchObject({ success: false })
    expect(dead.sender.send).not.toHaveBeenCalled()
  })
})

describe('sync IPC — remote trash', () => {
  it('lists and empties the remote trash', async () => {
    await expect(invoke('sync:list-trash', CONFIG)).resolves.toEqual([{ name: 'a', size: 1 }])
    await expect(invoke('sync:empty-trash', CONFIG)).resolves.toEqual({
      success: true,
      removed: 1
    })
  })
})
