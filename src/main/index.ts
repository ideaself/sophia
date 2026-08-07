import { app, BrowserWindow, ipcMain, shell, safeStorage, Tray, Menu, nativeImage, session, webContents, screen } from 'electron'
import trayIconDataUrl from '../../build/icon.png?inline'
import { join } from 'path'
import { readFile, writeFile } from 'node:fs/promises'
import { registerSettingsIpc } from './ipc/settings'
import { registerChatStreamIpc } from './ipc/chat-stream'
import { registerConversationIpc } from './ipc/data'
import { registerCompanionIpc } from './ipc/companions'
import { registerChatPromptIpc } from './ipc/chat-prompt'
import { registerProviderIpc } from './ipc/providers'
import { registerSyncIpc } from './ipc/sync'
import { registerArchiveIpc } from './ipc/archive'
import { registerLockIpc } from './ipc/lock'
import { initDataDir } from './storage/initialize'
import { resolveReferencePaths } from './storage/resolve-paths'
import { createDeepSeekStreamAdapter } from './llm/deepseek-stream-adapter'
import { maybeAutoBackup } from './backup/auto-backup'

function makeIcon(size: number): Electron.NativeImage {
  const buf = Buffer.alloc(size * size * 4)
  const m = Math.max(1, Math.floor(size * 0.2))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (x >= m && x < size - m && y >= m && y < size - m) {
        buf[i] = 0x63; buf[i + 1] = 0x6b; buf[i + 2] = 0xf1; buf[i + 3] = 0xff
      } else {
        buf[i + 3] = 0
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

async function loadWindowState(): Promise<WindowState | null> {
  try {
    const raw = await readFile(windowStatePath(), 'utf-8')
    const s = JSON.parse(raw) as Partial<WindowState>
    if (typeof s.width !== 'number' || typeof s.height !== 'number') return null
    if (s.width < 200 || s.height < 200) return null
    let x = s.x
    let y = s.y
    if (typeof x === 'number' && typeof y === 'number') {
      // 丢弃完全落在所有显示器工作区之外的坐标（如外接屏拔掉后）
      const onScreen = screen.getAllDisplays().some((d) => {
        const wa = d.workArea
        return x! < wa.x + wa.width && x! + s.width! > wa.x &&
          y! < wa.y + wa.height && y! + s.height! > wa.y
      })
      if (!onScreen) { x = undefined; y = undefined }
    }
    return { x, y, width: s.width, height: s.height, maximized: s.maximized === true }
  } catch {
    return null
  }
}

function saveWindowState(win: BrowserWindow): void {
  const bounds = win.getBounds()
  const state: WindowState = { ...bounds, maximized: win.isMaximized() }
  void writeFile(windowStatePath(), JSON.stringify(state), 'utf-8').catch(() => {})
}

function createWindow(): void {
  void loadWindowState().then((state) => {
    const mainWindow = new BrowserWindow({
      x: state?.x,
      y: state?.y,
      width: state?.width ?? 1200,
      height: state?.height ?? 800,
      show: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 在线词典浮层使用 <webview> 加载词典站点（不受 X-Frame-Options 限制）。
        // 安全由 will-attach-webview 强制约束，见下方 web-contents-created。
        webviewTag: true
      }
    })

    if (state?.maximized) mainWindow.maximize()

    // 记忆窗口位置/大小/最大化状态（拖动与缩放防抖保存，退出时兜底保存）
    let saveTimer: NodeJS.Timeout | null = null
    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => saveWindowState(mainWindow), 500)
    }
    mainWindow.on('resize', scheduleSave)
    mainWindow.on('move', scheduleSave)
    mainWindow.on('close', () => {
      if (isQuitting) saveWindowState(mainWindow)
    })

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error(`Renderer failed to load: ${errorCode} - ${errorDescription}`)
    })

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error(`Renderer process gone: ${details.reason}`)
    })

    mainWindow.on('ready-to-show', () => {
      mainWindow.focus()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    // System tray
    setupTray(mainWindow)

    // Hide to tray instead of closing
    mainWindow.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault()
        mainWindow.hide()
      }
    })
  })
}

/** Create the system tray with the real application icon. */
function setupTray(mainWindow: BrowserWindow): void {
  try {
    const tray = new Tray(loadTrayIcon())
    tray.setToolTip('Sophia')

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示窗口',
        click: () => {
          mainWindow.show()
          mainWindow.focus()
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          tray.destroy()
          app.quit()
        }
      }
    ])
    tray.setContextMenu(contextMenu)

    tray.on('double-click', () => {
      mainWindow.show()
      mainWindow.focus()
    })
  } catch {
    // Tray not available (e.g. headless/CI)
  }
}

/**
 * Load the real app icon for the tray.
 *
 * build/icon.png is shipped inside the package (see the "files" list in
 * package.json), so the same path works in dev and in the installed app.
 */
function loadTrayIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromDataURL(trayIconDataUrl)
  if (!icon.isEmpty()) {
    return makeTraySized(icon)
  }
  // Fallback placeholder (should never show in normal use).
  return makeIcon(16)
}

/** Fit an icon for the Windows tray (16×16 — the documented safe size). */
function makeTraySized(src: Electron.NativeImage): Electron.NativeImage {
  return src.resize({ width: 16, height: 16, quality: 'best' })
}

let isQuitting = false

// Single-instance lock: a second launch focuses the existing window instead
// of spawning a competing process over the same data directory.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    // Content Security Policy: restrict resource loading to local origin
    // and data: URIs (needed for KaTeX fonts, inline styles, etc.)
    // Also detects third-party dictionary iframes that refuse embedding
    // (X-Frame-Options / CSP frame-ancestors) — Chromium fires no iframe
    // error event for these, so the renderer would otherwise show a blank
    // popup. We cancel the request and notify the popup to show a fallback.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders ?? {}

      if (details.resourceType === 'subFrame' && details.webContentsId) {
        const get = (key: string): string => {
          const value = headers[key] ?? headers[key.toLowerCase()]
          return Array.isArray(value) ? value.join(',') : ''
        }
        const xfo = get('x-frame-options')
        const csp = get('content-security-policy')
        const frameBlocked =
          /deny|sameorigin/i.test(xfo) ||
          /frame-ancestors/i.test(csp)
        if (frameBlocked) {
          try {
            const wc = webContents.fromId(details.webContentsId)
            wc?.send('dict:frame-blocked', { url: details.url })
          } catch {
            // best-effort — fallback stays hidden, user can still open in browser
          }
          callback({ cancel: true })
          return
        }
      }

      const devUrl = process.env['ELECTRON_RENDERER_URL']
      if (devUrl && details.url.startsWith(devUrl)) {
        callback({})
        return
      }

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; " +
            "font-src 'self' data:; " +
            "connect-src 'self' https: http://localhost:* http://127.0.0.1:*; " +
            "frame-src https:; " +
            "object-src 'none'; " +
            "base-uri 'self'"
          ]
        }
      })
    })

    const dataRoot = app.getPath('userData')
    const { candidatesDir, worldPresetPath } = resolveReferencePaths(app.getAppPath())

    // Initialize local data layout (idempotent — safe to call on every start)
    try {
      await initDataDir({
        dataRoot,
        referenceDir: candidatesDir,
        worldPresetPath
      })
    } catch (err) {
      // Don't let a data-init failure abort startup silently — an unhandled
      // rejection here would skip createWindow() and leave a zombie process.
      console.error('Failed to initialize data directory:', err)
    }

    // 自动备份：每 7 天一次、保留最近 5 份（后台执行，不阻塞启动）
    void maybeAutoBackup(dataRoot)

    // Register IPC handlers that don't need the window
    ipcMain.handle('app:get-version', () => app.getVersion())
    ipcMain.handle('app:get-platform', () => process.platform)
    ipcMain.handle('app:minimize-to-tray', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.hide()
    })
    // Open external URLs in the system browser. Only http(s) is allowed.
    ipcMain.handle('app:open-external', async (_event, input: unknown) => {
      const url = typeof input === 'string' ? input : ''
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('Only http(s) URLs can be opened')
      }
      await shell.openExternal(url)
      return { success: true }
    })
    ipcMain.handle('app:open-data-dir', async () => {
      const error = await shell.openPath(dataRoot)
      return { success: !error, error: error || undefined }
    })
    const keyStore = registerSettingsIpc(dataRoot, safeStorage)
    const providerStore = registerProviderIpc(dataRoot, safeStorage)
    registerSyncIpc(dataRoot, safeStorage)
    registerConversationIpc(dataRoot, providerStore)
    registerCompanionIpc(dataRoot)
    registerChatPromptIpc(dataRoot, providerStore)
    registerArchiveIpc(dataRoot)
    registerLockIpc(dataRoot, safeStorage)

    createWindow()

    // Register chat streaming IPC (needs window reference + provider store)
    registerChatStreamIpc(
      () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (!win) throw new Error('No BrowserWindow available')
        return win.webContents
      },
      (params) => {
        return createDeepSeekStreamAdapter({ endpoint: params._endpoint }).streamChat(params)
      },
      async () => {
        const activeProvider = await providerStore.getActive()
        if (activeProvider) {
          const key = await providerStore.readApiKey(activeProvider.id)
          if (key) return key
        }
        return keyStore.readKey()
      },
      async () => {
        const activeProvider = await providerStore.getActive()
        if (activeProvider) {
          return { model: activeProvider.selectedModel, baseUrl: activeProvider.baseUrl }
        }
        return null
      }
    )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // Harden every attached <webview> (used by the dictionary popup): no node,
  // no preload, sandboxed, and only https pages may attach.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      delete webPreferences.preload
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      if (!/^https:\/\//i.test(params.src || '')) {
        event.preventDefault()
      }
    })
  })
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
