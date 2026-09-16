/**
 * Verify Electron security fuses on the packaged Windows binary.
 *
 * Run after `npm run build:win`:
 *   node scripts/verify-fuses.mjs
 *
 * Exits non-zero when the packaged app is missing or any expected fuse has
 * the wrong state, so the check can gate releases / CI packaging jobs.
 */

import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCurrentFuseWire, FuseState, FuseV1Options } from '@electron/fuses'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exePath = join(root, 'release', 'win-unpacked', 'Sophia.exe')

if (!existsSync(exePath)) {
  console.error(`Packaged binary not found: ${exePath}\nRun \`npm run build:win\` first.`)
  process.exit(1)
}

/** Expected wire state per fuse for a shipped build. */
const EXPECTED = [
  [FuseV1Options.RunAsNode, FuseState.DISABLE],
  [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE]
]

const wire = await getCurrentFuseWire(exePath)
const stateName = (value) =>
  Object.keys(FuseState).find((k) => FuseState[k] === value) ?? String(value)

let failed = 0
for (const [option, expected] of EXPECTED) {
  const fuseName = Object.keys(FuseV1Options).find((k) => FuseV1Options[k] === option)
  const actual = wire[option]
  const ok = actual === expected
  console.log(
    `  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${fuseName}: ${stateName(actual)} (expected ${stateName(expected)})`
  )
  if (!ok) failed++
}

if (failed > 0) {
  console.error('\nFUSE VERIFICATION FAILED')
  process.exit(1)
}
console.log('\n\x1b[32mFUSE VERIFICATION PASSED\x1b[0m')
