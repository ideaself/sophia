import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { atomicWriteFile } from '../../../src/main/storage/atomic-write'

const fsCtl = vi.hoisted(() => ({
  renameFailures: [] as Array<NodeJS.ErrnoException | null>,
  rmReject: false
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (from: string, to: string): Promise<void> => {
      if (fsCtl.renameFailures.length > 0) {
        const next = fsCtl.renameFailures.shift()
        if (next) throw next
      }
      return actual.rename(from, to)
    },
    rm: async (
      path: Parameters<typeof actual.rm>[0],
      options?: Parameters<typeof actual.rm>[1]
    ): Promise<void> => {
      if (fsCtl.rmReject) {
        fsCtl.rmReject = false
        throw new Error('rm blocked')
      }
      return actual.rm(path, options)
    }
  }
})

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sophia-atomic-'))
  fsCtl.renameFailures = []
  fsCtl.rmReject = false
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

describe('atomicWriteFile — rename retry', () => {
  it('retries transient Windows rename locks (EPERM / EBUSY) and then succeeds', async () => {
    fsCtl.renameFailures = [errno('EPERM'), errno('EBUSY'), null]
    const target = join(dir, 'retry.txt')

    await atomicWriteFile(target, 'ok', 'utf-8')

    expect(await readFile(target, 'utf-8')).toBe('ok')
  })

  it('gives up after exhausting the retry delays', async () => {
    fsCtl.renameFailures = [errno('EACCES'), errno('EPERM'), errno('EBUSY'), errno('EPERM')]
    const target = join(dir, 'exhausted.txt')

    await expect(atomicWriteFile(target, 'x', 'utf-8')).rejects.toMatchObject({
      code: 'EPERM'
    })
  })

  it('swallows a failing temp cleanup while surfacing the original error', async () => {
    fsCtl.renameFailures = [errno('ENOENT')]
    fsCtl.rmReject = true
    const target = join(dir, 'fail.txt')

    await expect(atomicWriteFile(target, 'x', 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
