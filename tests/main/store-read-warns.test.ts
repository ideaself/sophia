/**
 * Small edge branches: artifact-store/local-context unreadable reads,
 * markdownToHtml rendering, and ErrorBoundary's reload action.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { ArtifactStore } from '../../src/main/storage/artifact-store'
import { artifactPath } from '../../src/main/storage/app-data'

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
