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
  it('returns exactly 3 companions from the real candidates directory', async () => {
    const result = await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })

    expect(result.companions).toHaveLength(3)
    expect(result.count).toBe(3)
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
    expect(parsed).toHaveLength(3)

    for (const item of parsed) {
      const validated = CompanionSchema.safeParse(item)
      expect(validated.success).toBe(true)
    }
  })

  it('parses landau correctly (known file)', async () => {
    const result = await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })

    const landau = result.companions.find(c => c.name === '朗道')
    expect(landau).toBeDefined()
    if (landau) {
      expect(landau.gender).toBe('male')
      expect(landau.age).toBe(40)
      expect(landau.identity).toContain('理论物理')
      expect(landau.personalityKeywords.length).toBeGreaterThanOrEqual(2)
      expect(landau.personality.length).toBeGreaterThan(100)
      expect(landau.speakingStyle.length).toBeGreaterThan(10)
      expect(landau.emotionalExpressions.length).toBeGreaterThan(10)
      expect(landau.originalFile).toBe('landau.md')
    }
  })

  it('parses zu_chongzhi correctly (known file)', async () => {
    const result = await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })

    const zu = result.companions.find(c => c.name === '祖冲之')
    expect(zu).toBeDefined()
    if (zu) {
      expect(zu.gender).toBe('male')
      expect(zu.age).toBe(41)
      expect(zu.identity).toContain('数学')
      expect(zu.personalityKeywords.length).toBeGreaterThanOrEqual(2)
      expect(zu.personality.length).toBeGreaterThan(100)
      expect(zu.originalFile).toBe('zu_chongzhi.md')
    }
  })

  it('parses emily correctly (known file)', async () => {
    const result = await loadReferenceCompanions({
      candidatesDir,
      companionDir: tempDir
    })

    const emily = result.companions.find(c => c.name.startsWith('艾米莉'))
    expect(emily).toBeDefined()
    if (emily) {
      expect(emily.gender).toBe('female')
      expect(emily.age).toBe(28)
      expect(emily.identity).toContain('英语')
      expect(emily.originalFile).toBe('emily.md')
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
    const landau = index.find((c) => c.id === 'comp_landau')!
    landau.name = '朗道（已编辑）'
    landau.version = 2
    await writeFile(join(mergeDir, 'index.json'), JSON.stringify(index, null, 2), 'utf-8')

    const result = await loadReferenceCompanions({ candidatesDir, companionDir: mergeDir })
    const reloadedLandau = result.companions.find((c) => c.id === 'comp_landau')
    expect(reloadedLandau?.name).toBe('朗道（已编辑）')
    expect(reloadedLandau?.version).toBe(2)

    const persisted = (await readIndex()).find((c) => c.id === 'comp_landau')
    expect(persisted?.name).toBe('朗道（已编辑）')
  })

  it('does not resurrect a deleted candidate after a restart', async () => {
    await loadOnce()
    await recordDeletedCandidate(mergeDir, 'comp_zu_chongzhi')

    const result = await loadReferenceCompanions({ candidatesDir, companionDir: mergeDir })

    expect(result.companions.some((c) => c.id === 'comp_zu_chongzhi')).toBe(false)
    expect(result.count).toBe(2)
    const persisted = await readIndex()
    expect(persisted.some((c) => c.id === 'comp_zu_chongzhi')).toBe(false)
  })
})
