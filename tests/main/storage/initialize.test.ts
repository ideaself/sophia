import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { access, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { CompanionSchema } from '../../../src/shared/schemas/companion'

import { initDataDir, type InitOptions } from '../../../src/main/storage/initialize'


const TEST_ID = `sophia-init-${randomUUID()}`
const tempDir = join(tmpdir(), TEST_ID)
const projectsRoot = join(__dirname, '..', '..', '..')
const referenceDir = join(projectsRoot, 'reference', '角色设定', 'candidates')

// Path helpers matching the flat (single-user) app-data layout
const companionsRel = join('companions')

function buildOptions(overrides?: Partial<InitOptions>): InitOptions {
  return {
    dataRoot: join(tempDir, 'data'),
    referenceDir,
    ...overrides
  }
}

beforeAll(async () => {
  // tempDir is created as needed by initDataDir
})

afterAll(async () => {
  const { rm } = await import('node:fs/promises')
  await rm(tempDir, { recursive: true, force: true })
})

describe('initDataDir', () => {
  it('creates the data root directory', async () => {
    const opts = buildOptions()
    await initDataDir(opts)
    await access(opts.dataRoot)
  })

  it('creates config/ directory', async () => {
    const opts = buildOptions()
    await initDataDir(opts)
    await access(join(opts.dataRoot, 'config'))
  })


  it('learner.md is created as empty template', async () => {
    const opts = buildOptions()
    await initDataDir(opts)

    const raw = await readFile(
      join(opts.dataRoot, 'learner.md'),
      'utf-8'
    )

    expect(raw.length).toBeGreaterThan(0)
    expect(raw).toContain('#')
  })

  it('creates companions/ directory with 9 markdown files', async () => {
    const opts = buildOptions()
    await initDataDir(opts)

    const companionDir = join(opts.dataRoot, companionsRel)
    const entries = await readdir(companionDir)

    const mdFiles = entries.filter(e => e.endsWith('.md'))
    expect(mdFiles).toHaveLength(9)
  })

  it('companions/index.json validates all entries against CompanionSchema', async () => {
    const opts = buildOptions()
    await initDataDir(opts)

    const raw = await readFile(
      join(opts.dataRoot, companionsRel, 'index.json'),
      'utf-8'
    )
    const companions = JSON.parse(raw)

    expect(Array.isArray(companions)).toBe(true)
    expect(companions).toHaveLength(9)

    for (const companion of companions) {
      const result = CompanionSchema.safeParse(companion)
      if (!result.success) {
        console.error(`Schema failure for ${companion.name}:`, result.error.issues)
      }
      expect(result.success).toBe(true)
    }
  })

  it('result.companionCount is 9', async () => {
    const opts = buildOptions()
    const result = await initDataDir(opts)

    expect(result.companionCount).toBe(9)
  })

  it('is idempotent: running twice does not throw and files remain', async () => {
    const opts = buildOptions()
    await initDataDir(opts)
    await initDataDir(opts)

    // All files should still exist
    await access(join(opts.dataRoot, 'learner.md'))
    await access(join(opts.dataRoot, companionsRel, 'index.json'))
  })
})
