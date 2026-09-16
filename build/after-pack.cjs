/**
 * electron-builder `afterPack` hook — flip Electron security fuses on the
 * packaged binary.
 *
 * These fuses neuter runtime escape hatches that a packaged desktop app
 * should never expose:
 * - RunAsNode: prevents re-launching the binary as a plain Node runtime
 * - EnableNodeOptionsEnvironmentVariable: ignores NODE_OPTIONS injection
 * - EnableNodeCliInspectArguments: ignores --inspect debugger flags
 * - EnableCookieEncryption: encrypts the cookie store with OS crypto
 * - OnlyLoadAppFromAsar: refuses to load app code outside app.asar
 *
 * Dev mode (`npm run dev`) is unaffected — fuses only apply to packaged
 * output. Verify with `node scripts/verify-fuses.mjs` after `build:win`.
 */

const path = require('node:path')

/** @param {import('electron-builder').AfterPackContext} context */
module.exports = async function afterPack(context) {
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

  const productName = context.packager.appInfo.productFilename
  const electronPath =
    context.electronPlatformName === 'win32'
      ? path.join(context.appOutDir, `${productName}.exe`)
      : path.join(context.appOutDir, `${productName}.app`)

  await flipFuses(electronPath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  })

  console.log(`[after-pack] security fuses flipped: ${electronPath}`)
}
