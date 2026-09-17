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
    return { companionCount: 0 }
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
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        'Failed to initialize data directory:',
        expect.any(Error)
      )
    )
    // The window still comes up.
    await vi.waitFor(() => expect(cfg.windows.length).toBe(1))

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

    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith('App startup failed:', expect.any(Error))
    )
    cfg.getPathThrows = false
  })
})
