// Security baseline verification.
//
// Checks are intentionally source-based (the app is plain TS/TSX), but they
// are broader and safer than the original string probes:
// - every renderer file is scanned (not just App.tsx),
// - the preload may expose exactly ONE bridge, and it must be `sophia`,
// - missing files fail the check instead of crashing the script.
//
// Run via `npm run test:security` (wired into `npm test` and CI).

import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failed = 0
const failureDetails = []

function check(name, condition, detail) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
    passed++
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
    failed++
    failureDetails.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Read a source file, returning null (not throwing) when it is missing. */
function readSource(relPath) {
  try {
    return readFileSync(resolve(root, relPath), 'utf-8')
  } catch {
    return null
  }
}

/** Read a required source file; a missing file is recorded as a failure. */
function requireSource(relPath) {
  const src = readSource(relPath)
  if (src === null) check(`${relPath} exists`, false, 'file not found')
  return src
}

/** Recursively collect files under a directory (relative to repo root). */
function walkFiles(relDir, predicate) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (predicate(child)) out.push(child)
    }
  }
  try {
    walk(relDir)
  } catch {
    // directory missing — caller's checks on the file list will fail visibly
  }
  return out
}

// ─── Preload security ───────────────────────────────────────────────────────

console.log('\nPreload Security Checks (src/preload/index.ts):')
const preloadSrc = requireSource('src/preload/index.ts')

if (preloadSrc) {
  check('contextBridge.exposeInMainWorld present', preloadSrc.includes('contextBridge.exposeInMainWorld'))

  // Exactly one bridge may be exposed, and it must be the typed `sophia` API.
  const exposedNames = [...preloadSrc.matchAll(/exposeInMainWorld\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  check('exposes exactly one bridge entry-point', exposedNames.length === 1, `found: ${exposedNames.join(', ') || 'none'}`)
  check('the only bridge is "sophia"', exposedNames.length === 1 && exposedNames[0] === 'sophia', `found: ${exposedNames.join(', ')}`)

  check('Does NOT expose raw ipcRenderer', !preloadSrc.includes("exposeInMainWorld('ipcRenderer'"))
  check('Does NOT expose raw fs module', !preloadSrc.includes("exposeInMainWorld('fs'"))
  check('Does NOT expose raw shell module', !preloadSrc.includes("exposeInMainWorld('shell'"))
  check('Does NOT expose raw process global', !preloadSrc.includes("exposeInMainWorld('process'"))
  check('Does NOT expose raw electron module', !preloadSrc.includes("exposeInMainWorld('electron'"))
  check('Does NOT expose getDeepSeekKey API', !preloadSrc.includes('getDeepSeekKey'), 'plaintext key must never be readable from renderer')
  check('Does NOT expose getKey API', !preloadSrc.includes('getKey'), 'plaintext key must never be readable from renderer')
  check('Does NOT expose readKey API', !preloadSrc.includes('readKey'), 'plaintext key must never be readable from renderer')
  check('Exposes hasDeepSeekKey', preloadSrc.includes('hasDeepSeekKey'), 'settings API required')
  check('Exposes setDeepSeekKey', preloadSrc.includes('setDeepSeekKey'), 'settings API required')
  check('Exposes deleteDeepSeekKey', preloadSrc.includes('deleteDeepSeekKey'), 'settings API required')
}

// ─── Main process window security ───────────────────────────────────────────

console.log('\nMain Process Security Checks (src/main/index.ts):')
const mainSrc = requireSource('src/main/index.ts')

if (mainSrc) {
  check('contextIsolation: true', mainSrc.includes('contextIsolation: true'), 'renderer must not share JS context with preload')
  check('nodeIntegration: false', mainSrc.includes('nodeIntegration: false'), 'renderer must not have Node.js access')
  check('sandbox: true', mainSrc.includes('sandbox: true'), 'renderer must run in OS-level sandbox')
  check('webview attachments are hardened (will-attach-webview)', mainSrc.includes('will-attach-webview'), 'webviewTag must be constrained')
  check('window.open restricted to http(s)', mainSrc.includes('^https?:\\/\\/'), 'setWindowOpenHandler must validate the protocol')
}

// ─── Renderer isolation — ALL renderer files, not just App.tsx ──────────────

console.log('\nRenderer Isolation Checks (src/renderer/src, all files):')
const rendererFiles = walkFiles('src/renderer/src', (p) => /\.(ts|tsx)$/.test(p))

if (rendererFiles.length === 0) {
  check('renderer source files found', false, 'src/renderer/src contains no TS/TSX files')
} else {
  const offenders = (pattern) =>
    rendererFiles.filter((file) => pattern.test(readSource(file) ?? '')).map((f) => relative(root, f))

  const electronImports = offenders(/\bfrom\s+['"]electron['"]|\brequire\(\s*['"]electron['"]\s*\)/)
  check('no file imports electron directly', electronImports.length === 0, electronImports.join(', '))

  const fsImports = offenders(/\bfrom\s+['"](node:)?fs(\/promises)?['"]|\brequire\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/)
  check('no file imports fs directly', fsImports.length === 0, fsImports.join(', '))

  const ipcUsage = offenders(/\bipcRenderer\b/)
  check('no file touches ipcRenderer', ipcUsage.length === 0, ipcUsage.join(', '))

  const rawRequire = offenders(/\brequire\(\s*['"][^'"]+['"]\s*\)/)
  check('no CommonJS require() in renderer code', rawRequire.length === 0, rawRequire.join(', '))

  check('renderer talks to main only via window.sophia', (readSource('src/renderer/src/App.tsx') ?? '').includes('window.sophia'))
}

// ─── Settings IPC security ──────────────────────────────────────────────────

console.log('\nSettings IPC Security Checks (src/main/ipc/settings.ts):')
const settingsIpcSrc = requireSource('src/main/ipc/settings.ts')

if (settingsIpcSrc) {
  check('Settings IPC validates set-key with schema', settingsIpcSrc.includes('IpcSetDeepSeekKeyInputSchema'), 'Zod validation required on IPC boundary')
  check('Settings IPC does not expose readKey channel', !settingsIpcSrc.includes('settings:get-deepseek-key'), 'plaintext key must never leave main process')
  check('Settings IPC does not expose get-key channel', !settingsIpcSrc.includes('settings:read-deepseek-key'), 'plaintext key must never leave main process')
}

// ─── Preload type declaration ───────────────────────────────────────────────

console.log('\nType Declaration Checks (src/preload/index.d.ts):')
const preloadDeclSrc = requireSource('src/preload/index.d.ts')

if (preloadDeclSrc) {
  check('Augments global Window interface', preloadDeclSrc.includes('interface Window'))
  check('Declares window.sophia type', preloadDeclSrc.includes('sophia:'))
}

// ─── Chat stream IPC security ───────────────────────────────────────────────

console.log('\nChat Stream IPC Security Checks (src/main/ipc/chat-stream.ts):')
const streamIpcSrc = readSource('src/main/ipc/chat-stream.ts')

if (streamIpcSrc) {
  check('Chat stream IPC validates input with Zod schema', streamIpcSrc.includes('.parse('), 'Zod validation required on IPC boundary')
  check('Chat stream IPC does not expose readKey or getKey channel', !streamIpcSrc.includes('settings:get') && !streamIpcSrc.includes('settings:read'), 'API key must never leave main process')
  check('Chat stream IPC has session cleanup on completion', streamIpcSrc.includes('sessions.delete'), 'sessions must be cleaned up to prevent memory leaks')
} else {
  check('Chat stream IPC file exists', false, 'src/main/ipc/chat-stream.ts not found')
}

// ─── Preload chat API surface ───────────────────────────────────────────────

console.log('\nPreload Chat API Checks (src/preload/index.ts):')
if (preloadSrc) {
  check('Preload exposes startStream API', preloadSrc.includes('startStream'), 'chat API required')
  check('Preload exposes cancelStream API', preloadSrc.includes('cancelStream'), 'chat API required')
  check('Preload exposes onToken API', preloadSrc.includes('onToken'), 'chat API required')
  check('Preload exposes onError API', preloadSrc.includes('onError'), 'chat API required')
  check('Preload exposes onEnd API', preloadSrc.includes('onEnd'), 'chat API required')
  check('Preload exposes onUsage API', preloadSrc.includes('onUsage'), 'chat API required')
  check('Preload does NOT expose raw ipcRenderer.on for chat channels', !preloadSrc.includes("ipcRenderer.on('chat:"), 'renderer must not directly subscribe to IPC channels')
  check('Preload does NOT expose getKey or readKey in chat API', !preloadSrc.includes('readKey'), 'plaintext key must never be readable from renderer')
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const detail of failureDetails) console.log(`  - ${detail}`)
  console.log('\x1b[31mSECURITY BASELINE FAILED\x1b[0m')
  process.exit(1)
} else {
  console.log('\x1b[32mSECURITY BASELINE PASSED\x1b[0m')
}
