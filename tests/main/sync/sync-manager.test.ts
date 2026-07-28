import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { SyncManager, type SyncProgress } from '../../../src/main/sync/sync-manager'
import { saveSyncState, type SyncStateEntry } from '../../../src/main/sync/sync-state'
import type { WebDavConfig, WebDavRemoteFile } from '../../../src/main/sync/webdav-client'

const CONFIG: WebDavConfig = { url: 'https://example.com/dav', username: 'u', password: 'p' }

/** In-memory stand-in for SyncWebDavClient — records calls, serves canned data. */
class FakeClient {
  private remote = new Map<string, { content: Buffer; lastmod: string }>()
  private clock = 0
  uploads: { path: string; content: Buffer }[] = []
  downloads: string[] = []
  deletions: string[] = []

  /** Test helper: place a file on the fake server. */
  setRemote(path: string, content: string | Buffer, lastmod?: string): void {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
    this.remote.set(path, { content: buf, lastmod: lastmod ?? `mod-${++this.clock}` })
  }

  remoteLastmod(path: string): string {
    const f = this.remote.get(path)
    if (!f) throw new Error(`no such remote file: ${path}`)
    return f.lastmod
  }

  async uploadFile(path: string, content: string | Buffer | Readable): Promise<void> {
    let buf: Buffer
    if (content instanceof Readable) {
      const chunks: Buffer[] = []
      for await (const chunk of content) chunks.push(Buffer.from(chunk))
      buf = Buffer.concat(chunks)
    } else {
      buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
    }
    this.uploads.push({ path, content: buf })
    this.setRemote(path, buf)
  }
  async ensureDir(_dir: string): Promise<void> {}
  async deleteFile(path: string): Promise<void> {
    if (!this.remote.delete(path)) throw new Error(`no such remote file: ${path}`)
    this.deletions.push(path)
  }
  async listAllFilesDetailed(dir: string): Promise<WebDavRemoteFile[]> {
    return [...this.remote.entries()]
      .filter(([p]) => p.startsWith(dir + '/'))
      .map(([path, f]) => ({ path, size: f.content.length, lastmod: f.lastmod }))
  }
  async downloadFile(path: string): Promise<string> {
    const f = this.remote.get(path)
    if (!f) throw new Error(`no such remote file: ${path}`)
    this.downloads.push(path)
    return f.content.toString('utf-8')
  }
  async downloadToFile(path: string, localPath: string): Promise<void> {
    const f = this.remote.get(path)
    if (!f) throw new Error(`no such remote file: ${path}`)
    this.downloads.push(path)
    await writeFile(localPath, f.content)
  }
}

function makeManager(dataRoot: string, fake: FakeClient): SyncManager {
  const manager = new SyncManager(dataRoot)
  // Inject the fake over the private factory (test seam, no production change)
  ;(manager as unknown as { createClient: () => FakeClient }).createClient = () => fake
  return manager
}

let dataRoot: string
let parentDir: string

beforeEach(async () => {
  parentDir = await mkdtemp(join(tmpdir(), 'sophia-sync-'))
  dataRoot = join(parentDir, 'data')
  await mkdir(dataRoot, { recursive: true })
})

afterEach(async () => {
  await rm(parentDir, { recursive: true, force: true })
})

async function touch(rel: string, content: string | Buffer = 'x'): Promise<void> {
  const full = join(dataRoot, ...rel.split('/'))
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content)
}

async function localStat(rel: string): Promise<{ size: number; mtimeMs: number }> {
  const s = await stat(join(dataRoot, ...rel.split('/')))
  return { size: s.size, mtimeMs: s.mtimeMs }
}

function entry(
  local: { size: number; mtimeMs: number } | null,
  remote: { size: number; lastmod: string } | null
): SyncStateEntry {
  return {
    localSize: local?.size ?? null,
    localMtimeMs: local?.mtimeMs ?? null,
    remoteSize: remote?.size ?? null,
    remoteLastmod: remote?.lastmod ?? null
  }
}

const R = (rel: string) => '/sophia/' + rel

describe('SyncManager.push — transfer behaviour', () => {
  it('uploads files under the /sophia remote prefix', async () => {
    await touch('profiles/prof_default/worlds/world_default/story.md', '# story')

    const fake = new FakeClient()
    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(result.success).toBe(true)
    expect(result.transferred).toBe(1)
    expect(fake.uploads[0].path).toBe(R('profiles/prof_default/worlds/world_default/story.md'))
  })

  it('pushes and pulls through the same remote path layout', async () => {
    const storyRel = 'profiles/prof_default/worlds/world_default/story.md'
    await touch(storyRel, '# story')

    const fake = new FakeClient()
    await makeManager(dataRoot, fake).push(CONFIG)
    expect(fake.uploads[0].path.startsWith('/sophia/')).toBe(true)

    await rm(join(dataRoot, storyRel))
    await rm(join(dataRoot, 'sync-state.json'), { force: true })

    const pullResult = await makeManager(dataRoot, fake).pull(CONFIG)
    expect(pullResult.transferred).toBe(1)
    expect(await readFile(join(dataRoot, storyRel), 'utf-8')).toBe('# story')
  })
})

describe('SyncManager.push — incremental mirror', () => {
  it('skips files unchanged on both sides', async () => {
    await touch('a.md', 'hello')
    const ls = await localStat('a.md')
    const fake = new FakeClient()
    fake.setRemote(R('a.md'), 'hello', 'mod-1')
    await saveSyncState(dataRoot, {
      version: 1,
      files: { 'a.md': entry(ls, { size: 5, lastmod: 'mod-1' }) }
    })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(fake.uploads).toHaveLength(0)
    expect(result.skipped).toBe(1)
    expect(result.transferred).toBe(0)
  })

  it('uploads when the local file changed since last sync', async () => {
    await touch('a.md', 'hello')
    const ls = await localStat('a.md')
    const fake = new FakeClient()
    fake.setRemote(R('a.md'), 'hello', 'mod-1')
    await saveSyncState(dataRoot, {
      version: 1,
      files: { 'a.md': entry({ size: ls.size, mtimeMs: ls.mtimeMs - 60_000 }, { size: 5, lastmod: 'mod-1' }) }
    })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(result.transferred).toBe(1)
    expect(fake.uploads).toHaveLength(1)
  })

  it('uploads when the remote file was changed by another device', async () => {
    await touch('a.md', 'hello')
    const ls = await localStat('a.md')
    const fake = new FakeClient()
    fake.setRemote(R('a.md'), 'hello', 'mod-2') // server moved on
    await saveSyncState(dataRoot, {
      version: 1,
      files: { 'a.md': entry(ls, { size: 5, lastmod: 'mod-1' }) }
    })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(result.transferred).toBe(1)
  })

  it('second consecutive push transfers nothing', async () => {
    await touch('a.md', 'hello')
    const fake = new FakeClient()

    await makeManager(dataRoot, fake).push(CONFIG)
    expect(fake.uploads).toHaveLength(1)

    const result = await makeManager(dataRoot, fake).push(CONFIG)
    expect(result.transferred).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('deletes remote files that were synced before but are gone locally', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('ghost.md'), 'old', 'mod-1')
    await saveSyncState(dataRoot, {
      version: 1,
      files: { 'ghost.md': entry({ size: 3, mtimeMs: 123 }, { size: 3, lastmod: 'mod-1' }) }
    })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(fake.deletions).toEqual([R('ghost.md')])
    expect(result.deleted).toBe(1)
  })

  it('leaves never-synced remote files untouched', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('alien.md'), 'not ours', 'mod-1')
    await saveSyncState(dataRoot, { version: 1, files: {} })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(fake.deletions).toHaveLength(0)
    expect(result.deleted).toBe(0)
  })

  it('first push with no state seeds from the remote listing and cleans extras', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('orphan.md'), 'junk from old full-uploads', 'mod-1')

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(fake.deletions).toEqual([R('orphan.md')])
    expect(result.deleted).toBe(1)
  })
})

describe('SyncManager.pull — basic behaviour', () => {
  it('writes remote files into dataRoot after stripping the /sophia prefix', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('profiles/prof_default/profile.json'), '{"id":"x"}')

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.success).toBe(true)
    expect(result.transferred).toBe(1)
    expect(
      await readFile(join(dataRoot, 'profiles', 'prof_default', 'profile.json'), 'utf-8')
    ).toBe('{"id":"x"}')
  })

  it('refuses server paths that escape dataRoot via .. segments', async () => {
    const fake = new FakeClient()
    fake.setRemote('/sophia/../evil.txt', 'pwned')

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.transferred).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
    await expect(access(join(parentDir, 'evil.txt'))).rejects.toThrow()
  })

  it('refuses absolute server paths', async () => {
    const fake = new FakeClient()
    fake.setRemote('/sophia//etc/passwd', 'root:x:0:0')

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.transferred).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('SyncManager — sync-set filtering (junk from old versions)', () => {
  it('pull never downloads files that push would never upload', async () => {
    const fake = new FakeClient()
    // Junk left on the server by the old full-upload sync
    fake.setRemote(R('sync-state.json'), '{"version":1}', 'mod-1')
    fake.setRemote(R('config/webdav.key.enc'), 'a1b2c3', 'mod-2')
    fake.setRemote(R('profiles/prof_default/profile.json'), '{"id":"x"}', 'mod-3')

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.transferred).toBe(1)
    expect(fake.downloads).toEqual([R('profiles/prof_default/profile.json')])
    await expect(access(join(dataRoot, 'config', 'webdav.key.enc'))).rejects.toThrow()
  })

  it('pull removes previously-synced junk that is no longer in the sync set', async () => {
    // Machine already polluted by an earlier pull: junk on disk AND in state
    await touch('config/api.key.enc', 'deadbeef')
    const ls = await localStat('config/api.key.enc')
    await saveSyncState(dataRoot, {
      version: 1,
      files: { 'config/api.key.enc': entry(ls, { size: 8, lastmod: 'mod-1' }) }
    })
    const fake = new FakeClient()
    fake.setRemote(R('config/api.key.enc'), 'deadbeef', 'mod-1')

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(fake.downloads).toHaveLength(0)
    expect(result.deleted).toBe(1)
    await expect(access(join(dataRoot, 'config', 'api.key.enc'))).rejects.toThrow()
  })

  it('pull does not record junk in the rebuilt sync state', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('sync-state.json'), '{"version":1}', 'mod-1')
    fake.setRemote(R('a.md'), 'hello', 'mod-2')

    await makeManager(dataRoot, fake).pull(CONFIG)

    const state = JSON.parse(await readFile(join(dataRoot, 'sync-state.json'), 'utf-8'))
    expect(Object.keys(state.files)).toEqual(['a.md'])
  })

  it('push deletes remote junk that is not in the sync set, even without a state record', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('sync-state.json'), '{"version":1}', 'mod-1')
    fake.setRemote(R('config/api.key.enc'), 'deadbeef', 'mod-2')
    fake.setRemote(R('alien.md'), 'valid but unknown — leave alone', 'mod-3')
    await saveSyncState(dataRoot, { version: 1, files: {} })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(fake.deletions.sort()).toEqual([R('config/api.key.enc'), R('sync-state.json')].sort())
    expect(result.deleted).toBe(2)
  })
})

describe('SyncManager.pull — incremental mirror', () => {
  it('skips files unchanged on both sides', async () => {
    await touch('a.md', 'hello')
    const ls = await localStat('a.md')
    const fake = new FakeClient()
    fake.setRemote(R('a.md'), 'hello', 'mod-1')
    await saveSyncState(dataRoot, {
      version: 1,
      files: { 'a.md': entry(ls, { size: 5, lastmod: 'mod-1' }) }
    })

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(fake.downloads).toHaveLength(0)
    expect(result.skipped).toBe(1)
  })

  it('downloads when the remote file changed', async () => {
    await touch('a.md', 'old')
    const ls = await localStat('a.md')
    const fake = new FakeClient()
    fake.setRemote(R('a.md'), 'new!', 'mod-2')
    await saveSyncState(dataRoot, {
      version: 1,
      files: { 'a.md': entry(ls, { size: 3, lastmod: 'mod-1' }) }
    })

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.transferred).toBe(1)
    expect(await readFile(join(dataRoot, 'a.md'), 'utf-8')).toBe('new!')
  })

  it('second consecutive pull transfers nothing', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('a.md'), 'hello', 'mod-1')

    await makeManager(dataRoot, fake).pull(CONFIG)
    expect(fake.downloads).toHaveLength(1)

    const result = await makeManager(dataRoot, fake).pull(CONFIG)
    expect(result.transferred).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('deletes local files that were synced before but are gone remotely', async () => {
    await touch('old.md', 'was synced')
    const ls = await localStat('old.md')
    await saveSyncState(dataRoot, {
      version: 1,
      files: { 'old.md': entry(ls, { size: ls.size, lastmod: 'mod-1' }) }
    })
    const fake = new FakeClient() // server no longer has old.md

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.deleted).toBe(1)
    await expect(access(join(dataRoot, 'old.md'))).rejects.toThrow()
  })

  it('never deletes local files that were never synced', async () => {
    await touch('brand-new-companion.md', 'created locally, never pushed')
    await saveSyncState(dataRoot, { version: 1, files: {} })
    const fake = new FakeClient()

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.deleted).toBe(0)
    expect(await readFile(join(dataRoot, 'brand-new-companion.md'), 'utf-8')).toBe(
      'created locally, never pushed'
    )
  })

  it('first pull with no state deletes nothing', async () => {
    await touch('keep.md', 'precious')
    const fake = new FakeClient()

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.deleted).toBe(0)
    expect(await readFile(join(dataRoot, 'keep.md'), 'utf-8')).toBe('precious')
  })
})

describe('SyncManager — binary files (.pdf)', () => {
  const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80, 0x7f, 0x0a, 0x0d])

  it('pushes .pdf files as binary and pulls them back byte-identical', async () => {
    const relPdf = 'profiles/prof_default/worlds/world_default/textbooks/tb_1/source.pdf'
    await touch(relPdf, PDF_BYTES)

    const fake = new FakeClient()
    await makeManager(dataRoot, fake).push(CONFIG)

    expect(fake.uploads).toHaveLength(1)
    expect(fake.uploads[0].path).toBe(R(relPdf))
    expect(fake.uploads[0].content.equals(PDF_BYTES)).toBe(true)

    // Round-trip: pull into a fresh state
    await rm(join(dataRoot, relPdf))
    await rm(join(dataRoot, 'sync-state.json'), { force: true })

    const result = await makeManager(dataRoot, fake).pull(CONFIG)
    expect(result.transferred).toBe(1)

    const pulled = await readFile(join(dataRoot, relPdf))
    expect(pulled.equals(PDF_BYTES)).toBe(true)
  })
})

describe('SyncManager — progress reporting', () => {
  it('reports progress for each pushed file', async () => {
    await touch('a.md', '# a')
    await touch('b.md', '# b')
    const events: SyncProgress[] = []
    const fake = new FakeClient()

    await makeManager(dataRoot, fake).push(CONFIG, (p) => events.push(p))

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ direction: 'push', current: 1, total: 2 })
    expect(events[1]).toMatchObject({ direction: 'push', current: 2, total: 2 })
    expect(events.map((e) => e.file).sort()).toEqual(['a.md', 'b.md'])
  })

  it('reports progress for each pulled file', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('x.md'), 'x')
    fake.setRemote(R('y.md'), 'y')
    const events: SyncProgress[] = []

    await makeManager(dataRoot, fake).pull(CONFIG, (p) => events.push(p))

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ direction: 'pull', current: 1, total: 2, file: 'x.md' })
    expect(events[1]).toMatchObject({ direction: 'pull', current: 2, total: 2, file: 'y.md' })
  })

  it('keeps reporting progress for later files when one file fails', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('ok.md'), 'ok')
    // Point the state at a file the server lost -> deletion of a missing local file is a no-op;
    // instead simulate failure by corrupting after listing is not possible with FakeClient,
    // so use an unsafe path which errors inside the loop.
    fake.setRemote('/sophia/../bad.md', 'bad')
    const events: SyncProgress[] = []

    const result = await makeManager(dataRoot, fake).pull(CONFIG, (p) => events.push(p))

    expect(result.success).toBe(false)
    // ok.md still transferred despite the bad sibling
    expect(result.transferred).toBe(1)
    expect(events.some((e) => e.file === 'ok.md')).toBe(true)
  })
})

describe('SyncManager — plan previews', () => {
  it('planPush reports transfer/skip/delete counts without touching anything', async () => {
    await touch('new.md', 'n')
    const fake = new FakeClient()
    fake.setRemote(R('ghost.md'), 'old', 'mod-1')
    await saveSyncState(dataRoot, {
      version: 1,
      files: { 'ghost.md': entry({ size: 3, mtimeMs: 1 }, { size: 3, lastmod: 'mod-1' }) }
    })

    const plan = await makeManager(dataRoot, fake).planPush(CONFIG)

    expect(plan.transferCount).toBe(1)
    expect(plan.deleteCount).toBe(1)
    expect(plan.deleteSample).toEqual(['ghost.md'])
    expect(fake.uploads).toHaveLength(0)
    expect(fake.deletions).toHaveLength(0)
  })

  it('planPull reports counts without touching anything', async () => {
    await touch('old.md', 'was synced')
    const ls = await localStat('old.md')
    await saveSyncState(dataRoot, {
      version: 1,
      files: { 'old.md': entry(ls, { size: ls.size, lastmod: 'mod-1' }) }
    })
    const fake = new FakeClient()
    fake.setRemote(R('fresh.md'), 'f')

    const plan = await makeManager(dataRoot, fake).planPull(CONFIG)

    expect(plan.transferCount).toBe(1)
    expect(plan.deleteCount).toBe(1)
    expect(plan.deleteSample).toEqual(['old.md'])
    expect(fake.downloads).toHaveLength(0)
    expect(await readFile(join(dataRoot, 'old.md'), 'utf-8')).toBe('was synced')
  })
})
