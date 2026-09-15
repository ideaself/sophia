import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'

import { extractZipSafely } from '../../../src/main/backup/safe-extract'

let root: string
let dest: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sophia-extract-'))
  dest = join(root, 'out')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeZip(path: string, entries: Record<string, string>): Promise<void> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content)
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, buf)
}

describe('extractZipSafely', () => {
  it('extracts regular nested entries', async () => {
    const zipPath = join(root, 'ok.zip')
    await writeZip(zipPath, {
      'config/providers.json': '{"a":1}',
      'learner.md': '# learner'
    })

    await extractZipSafely(zipPath, dest)

    expect(await readFile(join(dest, 'config', 'providers.json'), 'utf-8')).toBe('{"a":1}')
    expect(await readFile(join(dest, 'learner.md'), 'utf-8')).toBe('# learner')
  })

  it('explicitly rejects zip-slip entries instead of writing outside dest', async () => {
    // JSZip happily writes "../evil.txt" into the archive; a naive extractor
    // would escape the destination directory.
    const zipPath = join(root, 'evil.zip')
    await writeZip(zipPath, {
      '../evil.txt': 'pwned',
      'good.txt': 'ok'
    })

    await expect(extractZipSafely(zipPath, dest)).rejects.toThrow(/非法路径/)
    // Nothing must have been written outside (or even inside) the destination.
    await expect(access(join(root, 'evil.txt'))).rejects.toThrow()
  })

  it('never materializes non-file entries', async () => {
    // A directory entry and a regular file: only the file is written.
    const zipPath = join(root, 'dirs.zip')
    await writeZip(zipPath, {
      'docs/': '',
      'docs/readme.txt': 'hi'
    })

    await extractZipSafely(zipPath, dest)
    expect(await readFile(join(dest, 'docs', 'readme.txt'), 'utf-8')).toBe('hi')
  })

  it('fails cleanly on a corrupt archive', async () => {
    const zipPath = join(root, 'broken.zip')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(zipPath, 'not a zip at all')
    await expect(extractZipSafely(zipPath, dest)).rejects.toThrow()
  })
})
