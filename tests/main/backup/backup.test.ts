import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createBackupZip } from '../../../src/main/backup/backup'
import { Extract } from 'unzipper'

let dataRoot: string
let destDir: string

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-backup-src-'))
  destDir = await mkdtemp(join(tmpdir(), 'sophia-backup-dst-'))
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
  await rm(destDir, { recursive: true, force: true })
})

describe('createBackupZip', () => {
  it('packs files and nested directories, then extracts back', async () => {
    await mkdir(join(dataRoot, 'worlds', 'world_default'), { recursive: true })
    await writeFile(join(dataRoot, 'conversation.json'), '{"a":1}', 'utf-8')
    await writeFile(join(dataRoot, 'worlds', 'world_default', 'learner.md'), '# 学习者', 'utf-8')

    const zipPath = join(destDir, 'backup.zip')
    const result = await createBackupZip(dataRoot, zipPath)
    expect(result.fileCount).toBe(2)

    const extractDir = join(destDir, 'extract')
    await mkdir(extractDir)
    await new Promise<void>((resolve, reject) => {
      createReadStream(zipPath)
        .pipe(new Extract({ path: extractDir }))
        .on('close', resolve)
        .on('error', reject)
    })

    const files = (await readdir(extractDir, { recursive: true })).map((p) =>
      String(p).replace(/\\/g, '/')
    )
    expect(files.sort()).toEqual([
      'conversation.json',
      'worlds',
      'worlds/world_default',
      'worlds/world_default/learner.md'
    ])
    const restored = await readFile(join(extractDir, 'worlds', 'world_default', 'learner.md'), 'utf-8')
    expect(restored).toBe('# 学习者')
  })

  it('surfaces write failures instead of crashing', async () => {
    await writeFile(join(dataRoot, 'a.txt'), 'x')

    // An existing directory as the destination makes the write stream fail.
    await expect(createBackupZip(dataRoot, destDir)).rejects.toThrow()
  })
})
