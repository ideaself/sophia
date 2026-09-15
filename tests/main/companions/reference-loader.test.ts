import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { CompanionSchema } from '../../../src/shared/schemas/companion'
import { CompanionSource } from '../../../src/shared/types/ids'

// We import the yet-to-be-implemented modules.
// Tests will fail (RED) until implementation exists.
import {
  loadReferenceCompanions,
  recordDeletedCandidate
} from '../../../src/main/companions/reference-loader'

const TEST_ID = `sophia-loader-${randomUUID()}`
const tempDir = join(tmpdir(), TEST_ID)
const projectsRoot = join(__dirname, '..', '..', '..')
const candidatesDir = join(projectsRoot, 'reference', '角色设定', 'candidates')

beforeAll(async () => {
  await mkdir(tempDir, { recursive: true })
})

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('loadReferenceCompanions', () => {
  it('returns exactly 9 companions from the real candidates directory', async () => {
    const result = await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })

    expect(result.companions).toHaveLength(9)
    expect(result.count).toBe(9)
  })

  it('every companion validates against CompanionSchema', async () => {
    const result = await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })

    for (const companion of result.companions) {
      const parsed = CompanionSchema.safeParse(companion)
      if (!parsed.success) {
        console.error(`Schema failure for ${companion.name}:`, parsed.error.issues)
      }
      expect(parsed.success).toBe(true)
    }
  })

  it('all companions have source = candidate', async () => {
    const result = await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })

    for (const companion of result.companions) {
      expect(companion.source).toBe(CompanionSource.Candidate)
    }
  })

  it('produces deterministic companion IDs', async () => {
    const result1 = await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })
    const result2 = await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })

    expect(result1.companions.map(c => c.id).sort())
      .toEqual(result2.companions.map(c => c.id).sort())
  })

  it('writes companion markdown copies to companionDir', async () => {
    const result = await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })

    for (const companion of result.companions) {
      const mdPath = join(tempDir, companion.originalFile)
      const content = await readFile(mdPath, 'utf-8')
      expect(content.length).toBeGreaterThan(0)
    }
  })

  it('writes index.json to companionDir with valid companion data', async () => {
    await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })

    const indexPath = join(tempDir, 'index.json')
    const raw = await readFile(indexPath, 'utf-8')
    const parsed = JSON.parse(raw)

    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(9)

    for (const item of parsed) {
      const validated = CompanionSchema.safeParse(item)
      expect(validated.success).toBe(true)
    }
  })

  it('parses alice correctly (known file)', async () => {
    const result = await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })

    const alice = result.companions.find(c => c.name === '爱丽丝')
    expect(alice).toBeDefined()
    if (alice) {
      expect(alice.gender).toBe('female')
      expect(alice.age).toBe(15)
      expect(alice.identity).toContain('化工系')
      expect(alice.personalityKeywords.length).toBeGreaterThanOrEqual(2)
      expect(alice.personality.length).toBeGreaterThan(100)
      expect(alice.speakingStyle.length).toBeGreaterThan(10)
      expect(alice.emotionalExpressions.length).toBeGreaterThan(10)
      expect(alice.originalFile).toBe('alice.md')
    }
  })

  it('parses holmes correctly (known file)', async () => {
    const result = await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })

    const holmes = result.companions.find(c => c.name === '福尔摩斯')
    expect(holmes).toBeDefined()
    if (holmes) {
      expect(holmes.gender).toBe('male')
      expect(holmes.age).toBe(35)
      expect(holmes.identity).toContain('法医')
      expect(holmes.personalityKeywords.length).toBeGreaterThanOrEqual(2)
      expect(holmes.personality.length).toBeGreaterThan(100)
      expect(holmes.originalFile).toBe('holmes.md')
    }
  })

  it('throws on non-existent candidates directory', async () => {
    await expect(
      loadReferenceCompanions({
        candidatesDir: join(tempDir, 'nonexistent'),
        companionDir: join(tempDir, 'out')
      })
    ).rejects.toThrow()
  })
})

describe('loadReferenceCompanions — merge survives restarts', () => {
  const mergeDir = join(tempDir, 'merge')

  async function loadOnce(): Promise<void> {
    await loadReferenceCompanions({ candidatesDir, companionDir: mergeDir })
  }

  async function readIndex(): Promise<Array<{ id: string; name: string; version?: number; source: string }>> {
    return JSON.parse(await readFile(join(mergeDir, 'index.json'), 'utf-8'))
  }

  it('keeps user edits to a candidate across reloads (no silent rollback)', async () => {
    await loadOnce()

    // Simulate companion:update — version bumped, name edited.
    const index = await readIndex()
    const alice = index.find((c) => c.id === 'comp_alice')!
    alice.name = '爱丽丝（已编辑）'
    alice.version = 2
    await writeFile(join(mergeDir, 'index.json'), JSON.stringify(index, null, 2), 'utf-8')

    const result = await loadReferenceCompanions({ candidatesDir, companionDir: mergeDir })
    const reloadedAlice = result.companions.find((c) => c.id === 'comp_alice')
    expect(reloadedAlice?.name).toBe('爱丽丝（已编辑）')
    expect(reloadedAlice?.version).toBe(2)

    const persisted = (await readIndex()).find((c) => c.id === 'comp_alice')
    expect(persisted?.name).toBe('爱丽丝（已编辑）')
  })

  it('does not resurrect a deleted candidate after a restart', async () => {
    await loadOnce()
    await recordDeletedCandidate(mergeDir, 'comp_holmes')

    const result = await loadReferenceCompanions({ candidatesDir, companionDir: mergeDir })

    expect(result.companions.some((c) => c.id === 'comp_holmes')).toBe(false)
    expect(result.count).toBe(8)
    const persisted = await readIndex()
    expect(persisted.some((c) => c.id === 'comp_holmes')).toBe(false)
  })
})
