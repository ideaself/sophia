/**
 * Packaged-app smoke test.
 *
 * Boots the unpacked build with an isolated user-data dir and asserts that it
 * (a) stays alive for the observation window and (b) actually initialized the
 * on-disk data layout — catching "builds fine but crashes on startup" and
 * broken first-run initialization before a release.
 *
 * Usage: npm run build:dir && npm run smoke
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, access, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const OBSERVE_MS = Number(process.env.SMOKE_OBSERVE_MS ?? 12_000)

if (process.platform !== 'win32') {
  console.log('[smoke] skipped: the packaged build is Windows-only')
  process.exit(0)
}

const exe = join('release', 'win-unpacked', 'Sophia.exe')
if (!existsSync(exe)) {
  console.error(`[smoke] FAIL: packaged app not found at ${exe} (run: npm run build:dir)`)
  process.exit(1)
}

const userData = await mkdtemp(join(tmpdir(), 'sophia-smoke-'))
const child = spawn(exe, [`--user-data-dir=${userData}`, '--disable-gpu'], {
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
child.stdout.on('data', (chunk) => (output += chunk.toString()))
child.stderr.on('data', (chunk) => (output += chunk.toString()))

const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)))

let failure = null
try {
  const earlyExit = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(null), OBSERVE_MS))
  ])

  if (earlyExit !== null) {
    failure = `process exited early with code ${earlyExit}`
  } else {
    // The main process is alive; the data layout must exist too.
    const configDir = join(userData, 'LocalData', 'config')
    try {
      await access(configDir)
    } catch {
      failure = `data layout was not initialized (missing ${configDir})`
    }
    if (!failure) {
      const learnerFile = join(userData, 'LocalData', 'learner.md')
      try {
        await readFile(learnerFile, 'utf-8')
      } catch {
        failure = `learner profile template missing (${learnerFile})`
      }
    }
  }
} finally {
  if (child.exitCode === null) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))])
  }
  // Best-effort: a lingering renderer may still hold the db journal on Windows.
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(
    () => {}
  )
}

if (failure) {
  console.error(`[smoke] FAIL: ${failure}`)
  if (output.trim()) console.error('[smoke] app output:\n' + output.split('\n').slice(-20).join('\n'))
  process.exit(1)
}

console.log(`[smoke] PASS: app booted, storage initialized, still alive after ${OBSERVE_MS / 1000}s`)
