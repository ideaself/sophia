import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { atomicWriteFile } from '../../../src/main/storage/atomic-write'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sophia-atomic-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('atomicWriteFile', () => {
  it('writes content to the target path', async () => {
    const target = join(dir, 'data.json')
    await atomicWriteFile(target, '{"ok":true}', 'utf-8')
    expect(await readFile(target, 'utf-8')).toBe('{"ok":true}')
  })

  it('overwrites existing content atomically', async () => {
    const target = join(dir, 'data.json')
    await writeFile(target, 'old', 'utf-8')
    await atomicWriteFile(target, 'new', 'utf-8')
    expect(await readFile(target, 'utf-8')).toBe('new')
  })

  it('accepts binary buffers (pdf/png/encrypted blobs)', async () => {
    const target = join(dir, 'blob.bin')
    const buf = Buffer.from([0x00, 0x25, 0x50, 0x44, 0x46, 0xff])
    await atomicWriteFile(target, buf)
    expect(await readFile(target)).toEqual(buf)
  })

  it('leaves no temp files behind after success or failure', async () => {
    const target = join(dir, 'data.json')
    await atomicWriteFile(target, 'x', 'utf-8')

    // Failure: target directory does not exist → write throws → tmp cleaned up.
    await expect(
      atomicWriteFile(join(dir, 'missing', 'nested', 'data.json'), 'y', 'utf-8')
    ).rejects.toThrow()

    const leftovers = (await readdir(dir)).filter((n) => n.startsWith('.tmp-'))
    expect(leftovers).toEqual([])
  })
})
