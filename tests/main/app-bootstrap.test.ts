/**
 * main/index.ts bootstrap — window hardening, IPC registration, CSP
 * injection/frame blocking, tray, close-to-tray, renderer crash recovery and
 * window-state persistence.
 *
 * electron is fully faked: app/BrowserWindow/ipcMain/session/tray/shell.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

type Handler = (event: unknown, input?: unknown) => Promise<unknown>

const h = vi.hoisted(() => {
  const state = {
    handlers: new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>(),
    appEvents: new Map<string, (...args: unknown[]) => void>(),
    ready: null as Promise<void> | null,
    resolveReady: null as (() => void) | null,
    userData: '',
    onHeadersReceived: null as ((details: unknown, cb: (arg: unknown) => void) => void) | null,
    sentToRenderer: [] as Array<{ id: number; channel: string; payload: unknown }>,
    webContentsFromId: 42,
    emptyIcon: false,
    throwOnNextWindow: false
  }

  class FakeTray {
    static instances: FakeTray[] = []
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    destroy = vi.fn()
    handlers: Record<string, () => void> = {}
    constructor(_icon?: unknown) {
      FakeTray.instances.push(this)
    }
    on(event: string, cb: () => void): this {
      this.handlers[event] = cb
      return this
    }
  }

  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = []
    static getAllWindows(): FakeBrowserWindow[] {
      return FakeBrowserWindow.instances.filter((w) => !w.destroyed)
    }
    static getFocusedWindow(): FakeBrowserWindow | null {
      return FakeBrowserWindow.instances[0] ?? null
    }

    options: Record<string, unknown>
    bounds = { x: 0, y: 0, width: 1200, height: 800 }
    maximized = false
    hidden = false
    destroyed = false
    minimized = false
    handlers: Record<string, (...args: unknown[]) => void> = {}
    handlerLists: Record<string, Array<(...args: unknown[]) => void>> = {}
    emitAll(event: string, ...args: unknown[]): void {
      for (const cb of this.handlerLists[event] ?? []) cb(...args)
    }
    loadURL = vi.fn(async () => {})
    loadFile = vi.fn(async () => {})
    show = vi.fn(() => {
      this.hidden = false
    })
    hide = vi.fn(() => {
      this.hidden = true
    })
    focus = vi.fn()
    restore = vi.fn(() => {
      this.minimized = false
    })
    maximize = vi.fn(() => {
      this.maximized = true
    })
    isMaximized = (): boolean => this.maximized
    isMinimized = (): boolean => this.minimized
    isDestroyed = (): boolean => this.destroyed
    getBounds = (): { x: number; y: number; width: number; height: number } => this.bounds

    webContents = {
      reload: vi.fn(),
      send: vi.fn(),
      session: {},
      handlers: {} as Record<string, (...args: unknown[]) => void>,
      setWindowOpenHandler: vi.fn((cb: (details: { url: string }) => unknown) => {
        this.webContents.handlers['window-open'] = cb as (...args: unknown[]) => void
      }),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        this.webContents.handlers[event] = cb
      })
    }

    constructor(options?: Record<string, unknown>) {
      if (state.throwOnNextWindow) {
        state.throwOnNextWindow = false
        throw new Error('no display available')
      }
      this.options = options ?? {}
      FakeBrowserWindow.instances.push(this)
    }

    on(event: string, cb: (...args: unknown[]) => void): this {
      this.handlers[event] = cb
      ;(this.handlerLists[event] ??= []).push(cb)
      return this
    }
  }

  const shellMock = { openExternal: vi.fn(async () => {}), openPath: vi.fn(async () => '') }

  const appMock = {
    requestSingleInstanceLock: () => true,
    whenReady: (): Promise<void> => {
      state.ready ??= new Promise<void>((resolve) => {
        state.resolveReady = resolve
      })
      return state.ready
    },
    quit: vi.fn(),
    getVersion: (): string => '0.1.2',
    getPath: (): string => state.userData,
    getAppPath: (): string => process.cwd(),
    on: (event: string, cb: (...args: unknown[]) => void): void => {
      state.appEvents.set(event, cb)
    }
  }

  return { state, FakeTray, FakeBrowserWindow, shellMock, appMock }
})

vi.mock('electron', () => ({
  app: h.appMock,
  BrowserWindow: h.FakeBrowserWindow,
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.state.handlers.set(channel, fn)
    }
  },
  shell: h.shellMock,
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, 'utf-8'),
    decryptString: (buf: Buffer) => buf.toString('utf-8')
  },
  Tray: h.FakeTray,
  Menu: { buildFromTemplate: (template: unknown) => ({ template }) },
  nativeImage: {
    createFromDataURL: () => ({ isEmpty: () => h.state.emptyIcon, resize: () => ({ sized: true }) }),
    createFromBuffer: () => ({ sized: false })
  },
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: (cb: (details: unknown, done: (arg: unknown) => void) => void) => {
          h.state.onHeadersReceived = cb
        }
      }
    }
  },
  webContents: {
    fromId: (id: number) => {
      h.state.webContentsFromId = id
      return {
        send: (channel: string, payload: unknown) =>
          h.state.sentToRenderer.push({ id, channel, payload })
      }
    }
  },
  screen: {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]
  }
}))

const atomicCtl = vi.hoisted(() => ({ fail: false }))

vi.mock('../../src/main/storage/atomic-write', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/main/storage/atomic-write')>()
  return {
    atomicWriteFile: async (
      ...args: Parameters<typeof actual.atomicWriteFile>
    ): Promise<void> => {
      if (atomicCtl.fail) throw new Error('simulated window-state write failure')
      return actual.atomicWriteFile(...args)
    }
  }
})

import '../../src/main/index'

let firstWindow: InstanceType<typeof h.FakeBrowserWindow>

async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const handler = h.state.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return (await handler({}, input)) as T
}

beforeAll(async () => {
  h.state.userData = await mkdtemp(join(tmpdir(), 'sophia-boot-'))
  await writeFile(
    join(h.state.userData, 'window-state.json'),
    JSON.stringify({ x: 100, y: 120, width: 900, height: 700, maximized: true }),
    'utf-8'
  )

  h.state.resolveReady?.()
  await h.state.ready
  await vi.waitFor(() => expect(h.FakeBrowserWindow.instances.length).toBe(1))
  firstWindow = h.FakeBrowserWindow.instances[0]
})

afterEach(() => {
  vi.useRealTimers()
})

describe('main bootstrap — window hardening', () => {
  it('creates the window with hardened webPreferences and restores its state', () => {
    const prefs = firstWindow.options.webPreferences as Record<string, unknown>
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.nodeIntegration).toBe(false)
    expect(prefs.sandbox).toBe(true)
    expect(prefs.webviewTag).toBe(true)
    expect(String(prefs.preload)).toMatch(/preload[\\/]index\.js$/)

    expect(firstWindow.options.width).toBe(900)
    expect(firstWindow.options.height).toBe(700)
    expect(firstWindow.options.x).toBe(100)
    expect(firstWindow.options.y).toBe(120)
    expect(firstWindow.maximize).toHaveBeenCalled()
    expect(firstWindow.loadFile).toHaveBeenCalled()
  })

  it('blocks non-http(s) window.open targets', () => {
    const handler = firstWindow.webContents.handlers['window-open'] as (d: {
      url: string
    }) => { action: string }

    expect(handler({ url: 'https://example.com/x' })).toEqual({ action: 'deny' })
    expect(h.shellMock.openExternal).toHaveBeenCalledWith('https://example.com/x')

    h.shellMock.openExternal.mockClear()
    expect(handler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(h.shellMock.openExternal).not.toHaveBeenCalled()
  })

  it('reloads the renderer after a crash, with a 30s cooldown', () => {
    const handler = firstWindow.webContents.handlers['render-process-gone'] as (
      e: unknown,
      d: { reason: string }
    ) => void

    handler({}, { reason: 'crashed' })
    expect(firstWindow.webContents.reload).toHaveBeenCalledTimes(1)

    handler({}, { reason: 'crashed' })
    expect(firstWindow.webContents.reload).toHaveBeenCalledTimes(1)
  })

  it('focuses the window on ready-to-show and clears the save timer on close', () => {
    firstWindow.handlers['ready-to-show']?.()
    expect(firstWindow.focus).toHaveBeenCalled()

    // 'closed' clears the pending debounced save (nothing to assert beyond
    // the handler not throwing).
    expect(() => firstWindow.handlers['closed']?.()).not.toThrow()
  })

  it('logs process-level failures without exiting', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      process.emit('uncaughtException', new Error('boom'))
      process.emit('unhandledRejection', 'reason', Promise.resolve())
      expect(error).toHaveBeenCalledWith('[main] uncaughtException:', expect.any(Error))
      expect(error).toHaveBeenCalledWith('[main] unhandledRejection:', 'reason')
    } finally {
      error.mockRestore()
    }
  })

  it('does not save the window state when the app is not quitting', async () => {
    firstWindow.bounds = { x: 7, y: 8, width: 500, height: 400 }
    expect(() => firstWindow.emitAll('close', { preventDefault: vi.fn() })).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))

    const raw = JSON.parse(
      await readFile(join(h.state.userData, 'window-state.json'), 'utf-8')
    ) as { x: number; y: number; width: number; height: number }
    expect(raw).toMatchObject({ x: 100, y: 120, width: 900, height: 700 })
  })

  it('hides instead of closing until the app quits', () => {
    const closeHandler = firstWindow.handlers['close'] as (e: RowButton) => void
    const preventDefault = vi.fn()
    closeHandler({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(firstWindow.hide).toHaveBeenCalled()

    // before-quit flips the quit flag: the second close goes through.
    h.state.appEvents.get('before-quit')?.()
    const preventDefault2 = vi.fn()
    closeHandler({ preventDefault: preventDefault2 })
    expect(preventDefault2).not.toHaveBeenCalled()
  })
})

interface RowButton {
  preventDefault: () => void
}

describe('main bootstrap — IPC surface', () => {
  it('answers app-level queries and validates external URLs', async () => {
    await expect(invoke('app:get-version')).resolves.toBe('0.1.2')
    await expect(invoke('app:get-platform')).resolves.toBe(process.platform)

    await expect(invoke('app:open-external', 'https://example.com')).resolves.toEqual({
      success: true
    })
    expect(h.shellMock.openExternal).toHaveBeenCalledWith('https://example.com')
    await expect(invoke('app:open-external', 'file:///etc/passwd')).rejects.toThrow(/http\(s\)/)

    await expect(invoke('app:open-data-dir')).resolves.toEqual({ success: true })
    expect(h.shellMock.openPath).toHaveBeenCalled()

    await invoke('app:minimize-to-tray')
    expect(firstWindow.hide).toHaveBeenCalled()
  })

  it('registers every IPC module', () => {
    for (const channel of [
      'settings:has-deepseek-key',
      'conversation:get',
      'companion:list',
      'chat:get-prompt-messages',
      'providers:list',
      'sync:test',
      'archive:list',
      'lock:has',
      'updater:check-for-updates'
    ]) {
      expect(h.state.handlers.has(channel), `missing handler: ${channel}`).toBe(true)
    }
  })

  it('tolerates window-less tray requests and rejects non-string URLs', async () => {
    const windows = h.FakeBrowserWindow.instances
    const destroyed = windows.map((w) => w.destroyed)
    windows.forEach((w) => (w.destroyed = true))
    try {
      await expect(invoke('app:minimize-to-tray')).resolves.toBeUndefined()

      h.shellMock.openExternal.mockClear()
      await expect(invoke('app:open-external', 123)).rejects.toThrow(/http\(s\)/)
      expect(h.shellMock.openExternal).not.toHaveBeenCalled()
    } finally {
      // Restore the module-level windows: later tests reuse them.
      windows.forEach((w, i) => (w.destroyed = destroyed[i]))
    }
  })
})

describe('main bootstrap — CSP and frame blocking', () => {
  it('injects the CSP header for app resources', () => {
    const result: { responseHeaders?: Record<string, string[]> } = {}
    h.state.onHeadersReceived?.({ url: 'app://x/index.html', responseHeaders: {} }, (arg) => {
      Object.assign(result, arg)
    })

    const csp = result.responseHeaders?.['Content-Security-Policy']?.[0] ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
  })

  it('handles a response without headers and leaves embeddable frames alone', () => {
    // No responseHeaders at all: the CSP injection must still work.
    const result: { cancel?: boolean; responseHeaders?: Record<string, string[]> } = {}
    h.state.onHeadersReceived?.({ url: 'app://x/index.html' }, (arg) => {
      Object.assign(result, arg)
    })
    expect(result.cancel).toBeUndefined()
    expect(result.responseHeaders?.['Content-Security-Policy']).toBeDefined()

    // A frame with no blocking headers must not be cancelled or reported.
    h.state.sentToRenderer = []
    const frame: { cancel?: boolean } = {}
    h.state.onHeadersReceived?.(
      {
        url: 'https://dict.example/w',
        resourceType: 'subFrame',
        webContentsId: 7,
        responseHeaders: {}
      },
      (a) => Object.assign(frame, a)
    )
    expect(frame.cancel).toBeUndefined()
    expect(h.state.sentToRenderer).toEqual([])
  })

  it('cancels dictionary frames that refuse embedding and notifies the popup', () => {
    const arg: { cancel?: boolean } = {}
    h.state.onHeadersReceived?.(
      {
        url: 'https://dict.example/word',
        resourceType: 'subFrame',
        webContentsId: 7,
        responseHeaders: { 'x-frame-options': ['DENY'] }
      },
      (a) => Object.assign(arg, a)
    )

    expect(arg.cancel).toBe(true)
    expect(h.state.webContentsFromId).toBe(7)
    expect(h.state.sentToRenderer).toEqual([
      { id: 7, channel: 'dict:frame-blocked', payload: { url: 'https://dict.example/word' } }
    ])
  })

  it('passes the dev server URL through untouched', () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    try {
      const calls: unknown[] = []
      h.state.onHeadersReceived?.(
        { url: 'http://localhost:5173/main.tsx', responseHeaders: {} },
        (a) => calls.push(a)
      )
      expect(calls).toEqual([{}])
    } finally {
      delete process.env['ELECTRON_RENDERER_URL']
    }
  })

  it('hardens every attached webview', () => {
    const createHandler = h.state.appEvents.get('web-contents-created') as (
      e: unknown,
      contents: {
        on: (
          event: string,
          cb: (e: RowButton, prefs: Record<string, unknown>, p: { src: string }) => void
        ) => void
      }
    ) => void
    let attachHandler!: (
      e: RowButton,
      prefs: Record<string, unknown>,
      params: { src: string }
    ) => void
    createHandler({}, { on: (_ev, cb) => (attachHandler = cb) })

    const prefs: Record<string, unknown> = {
      preload: 'evil.js',
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false
    }
    const blocked = vi.fn()
    attachHandler({ preventDefault: blocked }, prefs, { src: 'http://evil.example' })
    expect(blocked).toHaveBeenCalled()
    expect(prefs.preload).toBeUndefined()
    expect(prefs.nodeIntegration).toBe(false)
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.sandbox).toBe(true)
    expect(prefs.webSecurity).toBe(true)

    const allowed = vi.fn()
    attachHandler({ preventDefault: allowed }, { ...prefs }, { src: 'https://dict.example' })
    expect(allowed).not.toHaveBeenCalled()

    // Missing src is treated as "not https" and blocked.
    const noSrc = vi.fn()
    attachHandler({ preventDefault: noSrc }, { ...prefs }, {} as { src: string })
    expect(noSrc).toHaveBeenCalled()
  })
})

describe('main bootstrap — tray and lifecycle', () => {
  it('builds the tray menu with show/quit actions', () => {
    const tray = h.FakeTray.instances[0]
    expect(tray).toBeDefined()
    expect(tray.setToolTip).toHaveBeenCalledWith('Sophia')

    const menu = tray.setContextMenu.mock.calls[0][0] as {
      template: Array<{ label?: string; type?: string; click?: () => void }>
    }
    const labels = menu.template.map((t) => t.label ?? t.type)
    expect(labels).toContain('显示窗口')
    expect(labels).toContain('退出')

    tray.handlers['double-click']?.()
    expect(firstWindow.show).toHaveBeenCalled()
    expect(firstWindow.focus).toHaveBeenCalled()

    const showItem = menu.template.find((t) => t.label === '显示窗口')!
    firstWindow.show.mockClear()
    firstWindow.focus.mockClear()
    showItem.click?.()
    expect(firstWindow.show).toHaveBeenCalled()
    expect(firstWindow.focus).toHaveBeenCalled()

    const quitItem = menu.template.find((t) => t.label === '退出')!
    quitItem.click?.()
    expect(tray.destroy).toHaveBeenCalled()
    expect(h.appMock.quit).toHaveBeenCalled()
  })

  it('focuses the existing window on a second instance', () => {
    firstWindow.minimized = true
    const handler = h.state.appEvents.get('second-instance')!
    handler({}, [], '', {})
    expect(firstWindow.restore).toHaveBeenCalled()
    expect(firstWindow.focus).toHaveBeenCalled()
  })

  it('quits when all windows close on this platform', () => {
    h.appMock.quit.mockClear()
    h.state.appEvents.get('window-all-closed')?.()
    if (process.platform === 'darwin') {
      expect(h.appMock.quit).not.toHaveBeenCalled()
    } else {
      expect(h.appMock.quit).toHaveBeenCalled()
    }
  })

  it('keeps running on window-all-closed under darwin', () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    try {
      h.appMock.quit.mockClear()
      h.state.appEvents.get('window-all-closed')?.()
      expect(h.appMock.quit).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
  })

  it('tolerates a second instance when no window is open', () => {
    h.FakeBrowserWindow.instances.forEach((w) => (w.destroyed = true))
    const handler = h.state.appEvents.get('second-instance')!
    expect(() => handler({}, [], '', {})).not.toThrow()
  })

  it('focuses an unminimized window without restoring it', async () => {
    if (!h.FakeBrowserWindow.instances.some((w) => !w.destroyed)) {
      const idle = h.FakeBrowserWindow.instances.length
      h.state.appEvents.get('activate')?.()
      await vi.waitFor(() => expect(h.FakeBrowserWindow.instances.length).toBe(idle + 1))
    }
    const win = h.FakeBrowserWindow.instances.find((w) => !w.destroyed)!
    win.minimized = false
    win.restore.mockClear()
    win.focus.mockClear()

    h.state.appEvents.get('second-instance')!({}, [], '', {})

    expect(win.restore).not.toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it('creates a fresh window with defaults when the stored state is invalid', async () => {
    await writeFile(join(h.state.userData, 'window-state.json'), JSON.stringify({ width: 50 }), 'utf-8')
    const before = h.FakeBrowserWindow.instances.length

    // The activate handler recreates the window when none is open.
    h.FakeBrowserWindow.instances.forEach((w) => (w.destroyed = true))
    h.state.appEvents.get('activate')?.()

    await vi.waitFor(() => expect(h.FakeBrowserWindow.instances.length).toBe(before + 1))
    const fresh = h.FakeBrowserWindow.instances[before]
    expect(fresh.options.width).toBe(1200)
    expect(fresh.options.height).toBe(800)
    expect(fresh.options.x).toBeUndefined()
    expect(fresh.loadFile).toHaveBeenCalled()
  })

  it('rejects a window state whose y coordinate is not a number', async () => {
    await writeFile(
      join(h.state.userData, 'window-state.json'),
      JSON.stringify({ x: 10, y: 'top', width: 900, height: 700 }),
      'utf-8'
    )
    const before = h.FakeBrowserWindow.instances.length
    h.FakeBrowserWindow.instances.forEach((w) => (w.destroyed = true))
    h.state.appEvents.get('activate')?.()

    await vi.waitFor(() => expect(h.FakeBrowserWindow.instances.length).toBe(before + 1))
    const fresh = h.FakeBrowserWindow.instances[before]
    // Size is kept, but an untrustworthy position is dropped entirely.
    expect(fresh.options.x).toBeUndefined()
    expect(fresh.options.y).toBeUndefined()
    expect(fresh.options.width).toBe(900)
    expect(fresh.options.height).toBe(700)
  })

  it('does not create a window when one is already open on activate', async () => {
    if (!h.FakeBrowserWindow.instances.some((w) => !w.destroyed)) {
      const idle = h.FakeBrowserWindow.instances.length
      h.state.appEvents.get('activate')?.()
      await vi.waitFor(() => expect(h.FakeBrowserWindow.instances.length).toBe(idle + 1))
    }
    const before = h.FakeBrowserWindow.instances.length

    h.state.appEvents.get('activate')?.()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(h.FakeBrowserWindow.instances.length).toBe(before)
  })

  it('loads the dev server URL when one is provided', async () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    try {
      const before = h.FakeBrowserWindow.instances.length
      h.FakeBrowserWindow.instances.forEach((w) => (w.destroyed = true))
      h.state.appEvents.get('activate')?.()

      await vi.waitFor(() => expect(h.FakeBrowserWindow.instances.length).toBe(before + 1))
      const fresh = h.FakeBrowserWindow.instances[before]
      expect(fresh.loadURL).toHaveBeenCalledWith('http://localhost:5173')
      expect(fresh.loadFile).not.toHaveBeenCalled()
    } finally {
      delete process.env['ELECTRON_RENDERER_URL']
    }
  })

  it('debounces window-state writes on resize', { timeout: 30_000 }, async () => {
    vi.useFakeTimers()
    const win = firstWindow
    win.bounds = { x: 5, y: 6, width: 999, height: 777 }
    win.handlers['resize']?.()
    await vi.advanceTimersByTimeAsync(600)

    // The debounced write is async — poll until the atomic write lands.
    await vi.waitFor(async () => {
      const raw = await readFile(join(h.state.userData, 'window-state.json'), 'utf-8')
      expect(JSON.parse(raw)).toMatchObject({ x: 5, y: 6, width: 999, height: 777 })
    }, { timeout: 10_000 })
  })
})

describe('main bootstrap — environment branches', () => {
  it('falls back to a drawn tray icon when the packaged icon is empty', async () => {
    h.state.emptyIcon = true
    try {
      const before = h.FakeTray.instances.length
      h.FakeBrowserWindow.instances.forEach((w) => (w.destroyed = true))
      h.state.appEvents.get('activate')?.()

      await vi.waitFor(() => expect(h.FakeTray.instances.length).toBe(before + 1))
      expect(h.FakeTray.instances[before].setToolTip).toHaveBeenCalledWith('Sophia')
    } finally {
      h.state.emptyIcon = false
    }
  })

  it('recovers from a corrupt window-state file and logs window creation failures', async () => {
    await writeFile(join(h.state.userData, 'window-state.json'), '{ not json', 'utf-8')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const before = h.FakeBrowserWindow.instances.length
      h.FakeBrowserWindow.instances.forEach((w) => (w.destroyed = true))
      h.state.appEvents.get('activate')?.()
      await vi.waitFor(() => expect(h.FakeBrowserWindow.instances.length).toBe(before + 1))
      expect(h.FakeBrowserWindow.instances[before].options.width).toBe(1200)

      // The next creation fails outright → logged, not thrown.
      h.state.throwOnNextWindow = true
      h.FakeBrowserWindow.instances.forEach((w) => (w.destroyed = true))
      h.state.appEvents.get('activate')?.()
      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          'Failed to create main window:',
          expect.any(Error)
        )
      )
    } finally {
      error.mockRestore()
    }
  })

  it('saves the window state on close after the quit flag flips', async () => {
    const win = h.FakeBrowserWindow.instances[0]
    win.bounds = { x: 11, y: 22, width: 640, height: 480 }
    h.state.appEvents.get('before-quit')?.()

    win.emitAll('close', { preventDefault: vi.fn() })
    win.emitAll('closed')

    // The save is fire-and-forget; poll until the file is fully written.
    let saved: { x: number; y: number; width: number; height: number } | null = null
    await vi.waitFor(async () => {
      const raw = await readFile(join(h.state.userData, 'window-state.json'), 'utf-8')
      saved = JSON.parse(raw) as { x: number; y: number; width: number; height: number }
    })
    expect(saved).toMatchObject({ x: 11, y: 22, width: 640, height: 480 })
  })

  it('swallows window-state write failures when the data dir is gone', async () => {
    const win = h.FakeBrowserWindow.instances[0]
    atomicCtl.fail = true
    try {
      h.state.appEvents.get('before-quit')?.()
      expect(() => win.emitAll('close', { preventDefault: vi.fn() })).not.toThrow()
      // Let the rejected atomic write settle so its catch handler runs.
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      atomicCtl.fail = false
    }
  })
})

describe('main bootstrap — renderer failures', () => {
  it('logs renderer load failures', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const handler = firstWindow.webContents.handlers['did-fail-load'] as (
        e: unknown,
        code: number,
        description: string
      ) => void
      handler({}, -105, 'ERR_NAME_NOT_RESOLVED')
      expect(error).toHaveBeenCalledWith('Renderer failed to load: -105 - ERR_NAME_NOT_RESOLVED')
    } finally {
      error.mockRestore()
    }
  })
})
