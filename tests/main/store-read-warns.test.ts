/**
 * Small edge branches: artifact-store/local-context unreadable reads,
 * markdownToHtml rendering, and ErrorBoundary's reload action.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { ArtifactStore } from '../../src/main/storage/artifact-store'
import { artifactPath, artifactsDir } from '../../src/main/storage/app-data'

let dataRoot = ''

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-edge-'))
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('unreadable store files', () => {
  it('warns and returns null when an artifact file is unreadable', async () => {
    const store = new ArtifactStore(dataRoot)
    // A directory where the artifact JSON belongs → EISDIR (not NotFound).
    await mkdir(artifactPath(dataRoot, 'conv_1', 'art_1'), { recursive: true })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(store.get('art_1', 'conv_1')).resolves.toBeNull()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('artifact listing', () => {
  it('skips non-json entries in the artifacts directory', async () => {
    const store = new ArtifactStore(dataRoot)
    const note = await store.create('conv_1' as never, 'diary', '内容')

    // A stray non-json file must be ignored by list().
    await mkdir(artifactsDir(dataRoot, 'conv_1'), { recursive: true })
    await writeFile(join(artifactsDir(dataRoot, 'conv_1'), 'README.txt'), 'notes')

    const list = await store.list('conv_1')
    expect(list.map((a) => a.id)).toEqual([note.id])
  })
})
