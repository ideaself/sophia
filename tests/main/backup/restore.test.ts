import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createBackupZip } from '../../../src/main/backup/backup'
import { restoreFromBackup } from '../../../src/main/backup/restore'

const fsCtl = vi.hoisted(() => ({
  rmFailures: 0,
  readdirReject: null as unknown
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: async (
      path: Parameters<typeof actual.readdir>[0],
      options?: Parameters<typeof actual.readdir>[1]
    ): Promise<unknown> => {
      if (fsCtl.readdirReject !== null) {
        const value = fsCtl.readdirReject
        fsCtl.readdirReject = null
        throw value
      }
      return (actual.readdir as (p: unknown, o?: unknown) => Promise<unknown>)(path, options)
    },
    rm: async (
      path: Parameters<typeof actual.rm>[0],
      options?: Parameters<typeof actual.rm>[1]
    ): Promise<void> => {
      if (fsCtl.rmFailures > 0) {
        fsCtl.rmFailures--
        throw new Error('simulated rm failure')
      }
      return actual.rm(path, options)
    }
  }
})

const TEST_ID = `restore-${randomUUID()}`
const tempBase = join(tmpdir(), TEST_ID)

let dataRoot: string

beforeEach(async () => {
  fsCtl.rmFailures = 0
  fsCtl.readdirReject = null
  dataRoot = join(tempBase, 'Sophia')
  await mkdir(join(dataRoot, 'config'), { recursive: true })
  await mkdir(join(dataRoot, 'companions'), { recursive: true })
  await writeFile(join(dataRoot, 'config', 'providers.json'), JSON.stringify({ current: 'A' }))
  await writeFile(join(dataRoot, 'learner.md'), '# 学习者')
})

afterEach(async () => {
  await rm(tempBase, { recursive: true, force: true })
})

async function makeBackupZip(): Promise<string> {
  const zipPath = join(tempBase, 'backup.zip')
  await createBackupZip(dataRoot, zipPath)
  return zipPath
}

describe('restoreFromBackup', () => {
  it('replaces data root with the backup contents and keeps a pre-restore snapshot', async () => {
    const zip = await makeBackupZip()

    // 篡改当前数据，模拟"损坏/误删"状态
    await writeFile(join(dataRoot, 'config', 'providers.json'), JSON.stringify({ current: 'BROKEN' }))

    const result = await restoreFromBackup(dataRoot, zip)
    expect(result.success).toBe(true)
    expect(result.preRestore).toBeTruthy()

    // 数据被恢复为备份内容
    const providers = JSON.parse(await readFile(join(dataRoot, 'config', 'providers.json'), 'utf-8'))
    expect(providers.current).toBe('A')
    expect(await readFile(join(dataRoot, 'learner.md'), 'utf-8')).toBe('# 学习者')

    // 保险备份存在且非空（内容是篡改前的数据，zip 格式）
    const snapshotStat = await readFile(result.preRestore!)
    expect(snapshotStat.byteLength).toBeGreaterThan(100)
    expect(snapshotStat.subarray(0, 2).toString()).toBe('PK')
  })

  it('rejects a zip without the expected data layout and leaves data untouched', async () => {
    const badZip = join(tempBase, 'bad.zip')
    await createBackupZip(join(tempBase, 'unrelated'), badZip)
    await mkdir(join(tempBase, 'unrelated'), { recursive: true })
    await writeFile(join(tempBase, 'unrelated', 'note.txt'), 'not a backup')

    const before = await readFile(join(dataRoot, 'config', 'providers.json'), 'utf-8')
    const result = await restoreFromBackup(dataRoot, badZip)

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(await readFile(join(dataRoot, 'config', 'providers.json'), 'utf-8')).toBe(before)
  })

  it('fails cleanly on a nonexistent zip file', async () => {
    const result = await restoreFromBackup(dataRoot, join(tempBase, 'missing.zip'))
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    // 数据目录未被破坏
    expect(await readFile(join(dataRoot, 'config', 'providers.json'), 'utf-8')).toContain('"A"')
  })

  it('labels non-Error restore failures with String(err)', async () => {
    const zip = await makeBackupZip()
    fsCtl.readdirReject = 'weird failure'

    const result = await restoreFromBackup(dataRoot, zip)

    expect(result.success).toBe(false)
    expect(result.error).toBe('weird failure')
  })

  it('keeps restoring when the old data snapshot cannot be removed', async () => {
    const zip = await makeBackupZip()
    fsCtl.rmFailures = 1

    const result = await restoreFromBackup(dataRoot, zip)

    expect(result.success).toBe(true)
    expect(await readFile(join(dataRoot, 'learner.md'), 'utf-8')).toBe('# 学习者')
  })

  it('keeps the original error when the temp dir cleanup fails', async () => {
    const badZip = join(tempBase, 'no-layout.zip')
    await createBackupZip(join(tempBase, 'unrelated2'), badZip)
    await mkdir(join(tempBase, 'unrelated2'), { recursive: true })
    await writeFile(join(tempBase, 'unrelated2', 'note.txt'), 'not a backup')
    fsCtl.rmFailures = 1

    const result = await restoreFromBackup(dataRoot, badZip)

    expect(result.success).toBe(false)
    expect(result.error).toContain('备份文件缺少数据目录结构')
  })
})
