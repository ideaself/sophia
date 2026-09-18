/**
 * main/index.ts — environment edges that need a separate module instance:
 * second-instance lock, data-init failure, startup failure and the
 * chat-stream IPC callbacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const cfg = vi.hoisted(() => ({
  lock: true,
  initRejects: false,
  getPathThrows: false,
  readyResolvers: [] as Array<() => void>,
  chatStreamArgs: null as null | unknown[],
  windows: [] as Array<Record<string, unknown>>,
  quit: vi.fn()
}))

class FakeWindow {
  webContents = { send: vi.fn(), on: vi.fn(), setWindowOpenHandler: vi.fn() }
  loadURL = vi.fn(async () => {})
  loadFile = vi.fn(async () => {})
  on = vi.fn()
  show = vi.fn()
  hide = vi.fn()
  focus = vi.fn()
  maximize = vi.fn()
  isMaximized = (): boolean => false
  isMinimized = (): boolean => false
  isDestroyed = (): boolean => false
  getBounds = (): { x: number; y: number; width: number; height: number } => ({
    x: 0,
    y: 0,
    width: 1200,
    height: 800
  })
  static getAllWindows(): FakeWindow[] {
    return cfg.windows as unknown as FakeWindow[]
  }
  static getFocusedWindow(): FakeWindow | null {
    return (cfg.windows[0] as unknown as FakeWindow) ?? null
  }
  constructor() {
    cfg.windows.push(this as unknown as Record<string, unknown>)
  }
}

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: () => cfg.lock,
    whenReady: () =>
      new Promise<void>((resolve) => {
        cfg.readyResolvers.push(resolve)
      }),
    quit: cfg.quit,
    getVersion: () => '0.1.2',
    getPath: () => {
      if (cfg.getPathThrows) throw new Error('no home dir')
      return process.env['SOPHIA_TEST_DATA'] ?? process.cwd()
    },
    getAppPath: () => process.cwd(),
    on: vi.fn()
  },
  BrowserWindow: FakeWindow,
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  },
  Tray: class {
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    destroy = vi.fn()
    on = vi.fn()
  },
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: {
    createFromDataURL: () => ({ isEmpty: () => true, resize: () => ({}) }),
    createFromBuffer: () => ({})
  },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
  webContents: { fromId: () => ({ send: vi.fn() }) },
  screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 100, height: 100 } }] }
}))

vi.mock('../../src/main/storage/initialize', () => ({
  initDataDir: async () => {
    if (cfg.initRejects) throw new Error('disk full')
    return {
      companionCount: 0,
      dataVersion: { version: 1, migratedFrom: null, downgraded: false }
    }
  }
}))

vi.mock('../../src/main/ipc/chat-stream', () => ({
  registerChatStreamIpc: (...args: unknown[]) => {
    cfg.chatStreamArgs = args
  }
}))

// Keep the repo clean: the real auto-backup would write next to the data root.
vi.mock('../../src/main/backup/auto-backup', () => ({
  maybeAutoBackup: async () => undefined
}))

beforeEach(async () => {
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('main bootstrap — edge environments', () => {
  it('quits immediately when a second instance holds the lock', async () => {
    cfg.lock = false
    cfg.readyResolvers.length = 0

    await import('../../src/main/index')

    expect(cfg.quit).toHaveBeenCalled()
    expect(cfg.readyResolvers).toHaveLength(0)
    cfg.lock = true
  })

  it('keeps starting after a data-init failure and wires the stream callbacks', async () => {
    cfg.initRejects = true
    cfg.windows.length = 0
    cfg.readyResolvers.length = 0
    cfg.chatStreamArgs = null

    await import('../../src/main/index')
    cfg.readyResolvers.forEach((resolve) => resolve())
    await vi.waitFor(
      () =>
        expect(console.error).toHaveBeenCalledWith(
          'Failed to initialize data directory:',
          expect.any(Error)
        ),
      { timeout: 10_000 }
    )
    // The window still comes up.
    await vi.waitFor(() => expect(cfg.windows.length).toBe(1), { timeout: 10_000 })

    // createWindow → setupAutoUpdate → registerChatStreamIpc(…)
    const args = cfg.chatStreamArgs as unknown as [
      () => { send: unknown },
      (params: { _endpoint?: string }) => unknown,
      () => Promise<string | null>,
      () => Promise<{ model: string; baseUrl: string } | null>
    ]
    expect(args).toHaveLength(4)
    expect(args[0]()).toBeTruthy()
    expect(args[1]({ _endpoint: 'https://api.example.com' })).toBeTruthy()
    await expect(args[2]()).resolves.toBeNull()
    await expect(args[3]()).resolves.toBeNull()

    cfg.initRejects = false
  })

  it('logs startup failures instead of leaving an unhandled rejection', async () => {
    cfg.getPathThrows = true
    cfg.readyResolvers.length = 0
    await import('../../src/main/index')
    cfg.readyResolvers.forEach((resolve) => resolve())

    await vi.waitFor(
      () =>
        expect(console.error).toHaveBeenCalledWith('App startup failed:', expect.any(Error)),
      { timeout: 10_000 }
    )
    cfg.getPathThrows = false
  })
})

describe('main bootstrap — provider callbacks', () => {
  it('resolves the stream key and model from the active provider', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const envDir = await mkdtemp(join(tmpdir(), 'sophia-edge-'))
    process.env['SOPHIA_TEST_DATA'] = envDir
    try {
      const configDir = join(envDir, 'LocalData', 'config')
      await mkdir(configDir, { recursive: true })
      await writeFile(
        join(configDir, 'providers.json'),
        JSON.stringify([
          {
            id: 'prov_1',
            name: 'DeepSeek',
            type: 'deepseek',
            baseUrl: 'https://api.deepseek.com',
            models: ['deepseek-v4-flash'],
            selectedModel: 'deepseek-v4-flash',
            isActive: true,
            createdAt: '2026-09-16T10:00:00Z',
            updatedAt: '2026-09-16T10:00:00Z'
          }
        ]),
        'utf-8'
      )
      await writeFile(join(configDir, 'prov_1.key.enc'), Buffer.from('sk-live'))

      cfg.windows.length = 0
      cfg.readyResolvers.length = 0
      cfg.chatStreamArgs = null
      await import('../../src/main/index')
      cfg.readyResolvers.forEach((resolve) => resolve())
      await vi.waitFor(() => expect(cfg.chatStreamArgs).not.toBeNull(), { timeout: 10_000 })

      const args = cfg.chatStreamArgs as unknown as [
        unknown,
        unknown,
        () => Promise<string | null>,
        () => Promise<{ model: string; baseUrl: string } | null>
      ]
      await expect(args[2]()).resolves.toBe('sk-live')
      await expect(args[3]()).resolves.toEqual({
        model: 'deepseek-v4-flash',
        baseUrl: 'https://api.deepseek.com'
      })
    } finally {
      delete process.env['SOPHIA_TEST_DATA']
      const { rm: remove } = await import('node:fs/promises')
      await remove(envDir, { recursive: true, force: true })
    }
  })
})
