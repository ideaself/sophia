import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { palMomentsPath, palMomentsPathForTextbook } from '../../../src/main/storage/app-data'
import { loadPalMoments } from '../../../src/main/ipc/chat-prompt'

const WORLD_ID = 'world_default'

let dataRoot: string

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-pal-'))
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('loadPalMoments — 教学互动备忘按教材隔离', () => {
  it('有教材的课堂只读该教材专属的备忘文件（傅里叶备忘不串进微积分课堂）', async () => {
    const fourierPath = palMomentsPathForTextbook(dataRoot, 'tb_fourier', WORLD_ID)
    const calculusPath = palMomentsPathForTextbook(dataRoot, 'tb_calculus', WORLD_ID)
    await mkdir(join(calculusPath, '..'), { recursive: true })
    await writeFile(fourierPath, '## 2026-04-26 | 老师\n\n学习者复习傅里叶变换公式时…', 'utf-8')
    await writeFile(calculusPath, '## 2026-08-06 | 老师\n\n微积分：导数定义…', 'utf-8')

    expect(await loadPalMoments(dataRoot, WORLD_ID, 'tb_calculus')).toContain('导数定义')
    expect(await loadPalMoments(dataRoot, WORLD_ID, 'tb_calculus')).not.toContain('傅里叶')
    expect(await loadPalMoments(dataRoot, WORLD_ID, 'tb_fourier')).toContain('傅里叶')
  })

  it('有教材但该教材尚无备忘：返回空（不读全局旧文件）', async () => {
    await mkdir(join(palMomentsPath(dataRoot, WORLD_ID), '..'), { recursive: true })
    await writeFile(palMomentsPath(dataRoot, WORLD_ID), '## 2026-04-26 | 老师\n\n傅里叶光学：菲涅耳衍射…', 'utf-8')

    expect(await loadPalMoments(dataRoot, WORLD_ID, 'tb_calculus')).toBeUndefined()
  })

  it('无教材课堂读全局备忘文件', async () => {
    await mkdir(join(palMomentsPath(dataRoot, WORLD_ID), '..'), { recursive: true })
    await writeFile(palMomentsPath(dataRoot, WORLD_ID), '## 2026-04-26 | 老师\n\n自由讨论记录…', 'utf-8')

    expect(await loadPalMoments(dataRoot, WORLD_ID, null)).toContain('自由讨论')
  })

  it('文件不存在时返回 undefined', async () => {
    expect(await loadPalMoments(dataRoot, WORLD_ID, 'tb_x')).toBeUndefined()
    expect(await loadPalMoments(dataRoot, WORLD_ID, null)).toBeUndefined()
  })
})
