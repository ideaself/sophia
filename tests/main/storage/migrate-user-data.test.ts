import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateLegacyUserData } from '../../../src/main/storage/migrate-user-data'

let base: string
let appData: string
let current: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'sophia-migrate-'))
  appData = join(base, 'appdata')
  current = join(appData, 'sophia')
  await mkdir(appData, { recursive: true })
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('migrateLegacyUserData', () => {
  it('旧目录存在且新目录不存在 → 整体迁移', async () => {
    const legacy = join(appData, 'sophia')
    await mkdir(join(legacy, 'Sophia', 'config'), { recursive: true })
    await writeFile(join(legacy, 'Sophia', 'config', 'providers.json'), '{}')
    await writeFile(join(legacy, 'window-state.json'), '{}')

    const result = await migrateLegacyUserData(appData, current)
    expect(result.migrated).toBe(true)
    // 旧目录消失，内容在新目录
    expect(await exists(legacy)).toBe(false)
    expect(await exists(join(current, 'Sophia', 'config', 'providers.json'))).toBe(true)
    expect(await exists(join(current, 'window-state.json'))).toBe(true)
  })

  it('新目录已存在 → 跳过，不覆盖', async () => {
    await mkdir(join(appData, 'sophia'), { recursive: true })
    await mkdir(join(current, 'data'), { recursive: true })
    await writeFile(join(current, 'data', 'keep.txt'), 'keep')

    const result = await migrateLegacyUserData(appData, current)
    expect(result.migrated).toBe(false)
    expect(result.reason).toBeTruthy()
    expect(await exists(join(appData, 'sophia'))).toBe(true)
    expect(await exists(join(current, 'data', 'keep.txt'))).toBe(true)
  })

  it('旧目录不存在 → 无事发生', async () => {
    const result = await migrateLegacyUserData(appData, current)
    expect(result.migrated).toBe(false)
    expect(await exists(current)).toBe(false)
  })

  it('相同路径 → 直接跳过', async () => {
    const result = await migrateLegacyUserData(appData, current, 'sophia')
    expect(result.migrated).toBe(false)
  })
})

async function exists(p: string): Promise<boolean> {
  try {
    await import('node:fs/promises').then((m) => m.access(p))
    return true
  } catch {
    return false
  }
}
