import { mkdir, readFile, access, readdir } from 'node:fs/promises'
import type { Artifact } from '../../shared/schemas/artifact'
import { ArtifactSchema } from '../../shared/schemas/artifact'
import type { ArtifactId, ConversationId } from '../../shared/types/ids'
import { artifactsDir, artifactPath } from './app-data'
import { isNotFoundError, warnReadFailure } from './fs-errors'
import { atomicWriteFile } from './atomic-write'

type ArtifactTypeValue = 'lesson_summary' | 'flashcards' | 'diary' | 'progress' | 'handoff_tail' | 'farewell' | 'learner_profile' | 'pal_moments' | 'relation' | 'companion_note' | 'feynman_note' | 'knowledge_graph'

let idCounter = 0

function generateId(): ArtifactId {
  idCounter += 1
  return `art_${Date.now()}_${idCounter}` as ArtifactId
}

export class ArtifactStore {
  constructor(private readonly dataRoot: string) {}

  async create(
    conversationId: ConversationId,
    type: ArtifactTypeValue,
    content: string
  ): Promise<Artifact> {
    const now = new Date().toISOString()
    const id = generateId() as ArtifactId

    const raw: Record<string, unknown> = {
      id,
      conversationId,
      type,
      content,
      createdAt: now
    }
    const artifact = raw as unknown as Artifact

    await mkdir(artifactsDir(this.dataRoot, conversationId), { recursive: true })
    await atomicWriteFile(
      artifactPath(this.dataRoot, conversationId, id),
      JSON.stringify(artifact, null, 2),
      'utf-8'
    )

    return artifact
  }

  async get(artifactId: string, conversationId: string): Promise<Artifact | null> {
    try {
      const content = await readFile(
        artifactPath(this.dataRoot, conversationId, artifactId),
        'utf-8'
      )
      const parsed = ArtifactSchema.parse(JSON.parse(content))
      return parsed as unknown as Artifact
    } catch (err) {
      if (!isNotFoundError(err)) warnReadFailure(`artifact ${artifactId}`, err)
      return null
    }
  }

  async list(conversationId: string): Promise<Artifact[]> {
    try {
      await access(artifactsDir(this.dataRoot, conversationId))
    } catch {
      return []
    }

    const entries = await readdir(artifactsDir(this.dataRoot, conversationId))
    const artifacts: Artifact[] = []

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const id = entry.replace(/\.json$/, '')
      const art = await this.get(id, conversationId)
      if (art) {
        artifacts.push(art)
      }
    }

    return artifacts.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /**
   * Replace an artifact's content in place (keeps id / createdAt).
   * Returns the updated artifact, or null when it does not exist.
   */
  async update(
    artifactId: string,
    conversationId: string,
    content: string
  ): Promise<Artifact | null> {
    const filePath = artifactPath(this.dataRoot, conversationId, artifactId)
    let existing: Artifact
    try {
      const raw = await readFile(filePath, 'utf-8')
      existing = ArtifactSchema.parse(JSON.parse(raw)) as unknown as Artifact
    } catch (err) {
      if (!isNotFoundError(err)) warnReadFailure(`artifact ${artifactId}`, err)
      return null
    }

    const updated: Artifact = { ...existing, content }
    await atomicWriteFile(filePath, JSON.stringify(updated, null, 2), 'utf-8')
    return updated
  }
}
