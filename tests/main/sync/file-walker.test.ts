import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { collectSyncableFiles } from '../../../src/main/sync/file-walker'

let dataRoot: string

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-walker-'))
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

async function touch(rel: string): Promise<void> {
  const full = join(dataRoot, ...rel.split('/'))
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, 'x', 'utf-8')
}

async function collected(): Promise<string[]> {
  const files = await collectSyncableFiles(dataRoot)
  return files.map((f) => f.relativePath).sort()
}

describe('collectSyncableFiles', () => {
  it('includes companions so characters sync across machines', async () => {
    await touch('profiles/prof_default/worlds/world_default/companions/index.json')
    await touch('profiles/prof_default/worlds/world_default/companions/alice.md')

    const files = await collected()
    expect(files).toContain('profiles/prof_default/worlds/world_default/companions/index.json')
    expect(files).toContain('profiles/prof_default/worlds/world_default/companions/alice.md')
  })

  it('includes textbooks, conversations, and world data', async () => {
    await touch('profiles/prof_default/worlds/world_default/textbooks/tb_1/textbook.json')
    await touch('profiles/prof_default/worlds/world_default/textbooks/tb_1/source.md')
    await touch('profiles/prof_default/worlds/world_default/conversations/c_1/messages.json')
    await touch('profiles/prof_default/worlds/world_default/story.md')

    const files = await collected()
    expect(files).toHaveLength(4)
  })

  it('excludes encrypted API key files under config/', async () => {
    await touch('config/prov_123_1.key.enc')
    await touch('config/providers.json')

    const files = await collected()
    expect(files).toEqual(['config/providers.json'])
  })

  it('excludes the encrypted WebDAV password under config/', async () => {
    await touch('config/webdav-password.enc')
    await touch('config/providers.json')

    const files = await collected()
    expect(files).toEqual(['config/providers.json'])
  })

  it('excludes the encrypted DeepSeek key under config/', async () => {
    await touch('config/deepseek-key.enc')
    await touch('config/providers.json')

    const files = await collected()
    expect(files).toEqual(['config/providers.json'])
  })

  it('excludes the local sync-state bookkeeping file', async () => {
    await touch('sync-state.json')
    await touch('profiles/prof_default/worlds/world_default/story.md')

    const files = await collected()
    expect(files).toEqual(['profiles/prof_default/worlds/world_default/story.md'])
  })
})
