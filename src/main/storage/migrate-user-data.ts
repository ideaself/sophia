import { rename, access } from 'node:fs/promises'
import { join } from 'node:path'

export interface MigrateResult {
  migrated: boolean
  /** 未迁移时的原因（可选）。 */
  reason?: string
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/**
 * 品牌从 sophia 迁移到 sophia 后，Electron 的 userData 目录会
 * 变为新的（%APPDATA%\sophia）。把旧用户数据目录整体 rename 到新位置，
 * 数据、窗口状态、备份目录一次搬完。
 *
 * 幂等且保守：新目录已存在 / 旧目录不存在 / rename 失败时都不动数据，
 * 失败时调用方回退继续使用旧目录（数据始终不丢）。
 */
export async function migrateLegacyUserData(
  appDataDir: string,
  currentUserDataDir: string,
  legacyAppName = 'sophia'
): Promise<MigrateResult> {
  const legacyDir = join(appDataDir, legacyAppName)
  if (legacyDir === currentUserDataDir) return { migrated: false }

  if (!(await exists(legacyDir))) return { migrated: false }
  if (await exists(currentUserDataDir)) {
    return { migrated: false, reason: '新数据目录已存在，跳过迁移（不覆盖）' }
  }

  try {
    await rename(legacyDir, currentUserDataDir)
    return { migrated: true }
  } catch (err) {
    return { migrated: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
