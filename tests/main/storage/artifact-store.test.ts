import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { ArtifactStore } from '../../../src/main/storage/artifact-store'
import { artifactsDir } from '../../../src/main/storage/app-data'
import { ArtifactType } from '../../../src/shared/types/ids'
import type { ConversationId } from '../../../src/shared/types/ids'

let dataRoot: string
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-artifactstore-'))
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  warnSpy.mockRestore()
  await rm(dataRoot, { recursive: true, force: true })
})

describe('ArtifactStore round-trip', () => {
  it('reads back every artifact type the pipeline can generate', async () => {
    const store = new ArtifactStore(dataRoot)
    const conversationId = 'conv_roundtrip' as ConversationId

    const created = []
    for (const type of Object.values(ArtifactType)) {
      created.push(await store.create(conversationId, type, `content for ${type}`))
    }

    const listed = await store.list(conversationId)
    expect(listed).toHaveLength(created.length)
    expect(new Set(listed.map((a) => a.type))).toEqual(new Set(Object.values(ArtifactType)))

    for (const artifact of created) {
      const fetched = await store.get(artifact.id, conversationId)
      expect(fetched, `${artifact.type} must be readable`).not.toBeNull()
      expect(fetched?.type).toBe(artifact.type)
      expect(fetched?.content).toBe(`content for ${artifact.type}`)
    }

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('keeps lesson media artifacts readable (regression: enum drift)', async () => {
    const store = new ArtifactStore(dataRoot)
    const conversationId = 'conv_media' as ConversationId

    for (const type of [ArtifactType.LessonAudio, ArtifactType.LessonTimeline, ArtifactType.LessonFaq]) {
      await store.create(conversationId, type, '{}')
    }

    const listed = await store.list(conversationId)
    expect(listed.map((a) => a.type).sort()).toEqual(
      [ArtifactType.LessonAudio, ArtifactType.LessonFaq, ArtifactType.LessonTimeline].sort()
    )
  })

  it('updates an artifact in place keeping its id and createdAt', async () => {
    const store = new ArtifactStore(dataRoot)
    const conversationId = 'conv_update' as ConversationId
    const created = await store.create(conversationId, ArtifactType.LessonFaq, 'old')

    const updated = await store.update(created.id, conversationId, 'new')
    expect(updated?.id).toBe(created.id)
    expect(updated?.createdAt).toBe(created.createdAt)
    expect(updated?.content).toBe('new')

    const fetched = await store.get(created.id, conversationId)
    expect(fetched?.content).toBe('new')
  })

  it('skips artifacts whose JSON is unreadable', async () => {
    const store = new ArtifactStore(dataRoot)
    const conversationId = 'conv_corrupt' as ConversationId
    const kept = await store.create(conversationId, ArtifactType.LessonFaq, 'ok')
    await writeFile(join(artifactsDir(dataRoot, conversationId), 'art_broken.json'), '{not json')

    const listed = await store.list(conversationId)
    expect(listed.map((a) => a.id)).toEqual([kept.id])
    expect(warnSpy).toHaveBeenCalled()
  })
})
