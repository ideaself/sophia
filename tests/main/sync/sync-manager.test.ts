import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, access, stat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { SyncManager, type SyncProgress } from '../../../src/main/sync/sync-manager'
import { saveSyncState, type SyncStateEntry } from '../../../src/main/sync/sync-state'
import type { WebDavConfig, WebDavFile, WebDavRemoteFile } from '../../../src/main/sync/webdav-client'

const CONFIG: WebDavConfig = { url: 'https://example.com/dav', username: 'u', password: 'p' }

/** In-memory stand-in for SyncWebDavClient — records calls, serves canned data. */
class FakeClient {
  private remote = new Map<string, { content: Buffer; lastmod: string }>()
  private dirs = new Set<string>()
  private clock = 0
  uploads: { path: string; content: Buffer }[] = []
  downloads: string[] = []
  deletions: string[] = []
  moves: { path: string; target: string }[] = []
  /** Test hooks: paths whose corresponding operation should fail. */
  failUploads = new Set<string>()
  failDownloads = new Set<string>()
  failMoves = new Set<string>()
  failDeletes = new Set<string>()

  /** Register parent directories of a path (WebDAV collections exist implicitly). */
  private ensureParentDirs(path: string): void {
    const parts = path.split('/').filter((p) => p.length > 0)
    let cur = ''
    for (const p of parts.slice(0, -1)) {
      cur += '/' + p
      this.dirs.add(cur)
    }
  }

  /** Test helper: place a file on the fake server. */
  setRemote(path: string, content: string | Buffer, lastmod?: string): void {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
    this.ensureParentDirs(path)
    this.remote.set(path, { content: buf, lastmod: lastmod ?? `mod-${++this.clock}` })
  }

  remoteLastmod(path: string): string {
    const f = this.remote.get(path)
    if (!f) throw new Error(`no such remote file: ${path}`)
    return f.lastmod
  }

  hasRemote(path: string): boolean {
    return this.remote.has(path)
  }

  remoteCount(): number {
    return this.remote.size
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
    if (this.failUploads.has(path)) throw new Error(`upload rejected: ${path}`)
    this.uploads.push({ path, content: buf })
    this.setRemote(path, buf)
  }
  async ensureDir(_dir: string): Promise<void> {}
  async listFiles(dir: string): Promise<WebDavFile[]> {
    const children = new Map<string, boolean>()
    for (const key of this.remote.keys()) {
      if (!key.startsWith(dir + '/')) continue
      const rest = key.slice(dir.length + 1)
      children.set(rest.split('/')[0], rest.includes('/'))
    }
    return [...children.entries()].map(([name, isDir]) => ({ path: `${dir}/${name}`, isDir }))
  }
  async deleteFile(path: string): Promise<void> {
    if (this.failDeletes.has(path)) throw new Error(`delete rejected: ${path}`)
    // Real servers delete collections recursively — simulate that with
    // directory tracking: files under the path, then the collection itself.
    const keys = [...this.remote.keys()]
    const children = keys.filter((k) => k.startsWith(path + '/'))
    const wasDir = this.dirs.has(path)
    for (const k of children) this.remote.delete(k)
    for (const d of [...this.dirs]) {
      if (d === path || d.startsWith(path + '/')) this.dirs.delete(d)
    }
    if (this.remote.delete(path) || wasDir || children.length > 0) {
      this.deletions.push(path)
      return
    }
    throw new Error(`no such remote file: ${path}`)
  }
  async moveFile(path: string, target: string): Promise<void> {
    if (this.failMoves.has(path)) throw new Error(`move rejected: ${path}`)
    const keys = [...this.remote.keys()]
    const children = keys.filter((k) => k === path || k.startsWith(path + '/'))
    const wasDir = this.dirs.has(path)
    if (children.length === 0 && !wasDir) throw new Error(`no such remote file: ${path}`)
    const entries = children.map((k) => [k, this.remote.get(k)!] as const)
    for (const [k, f] of entries) {
      this.remote.delete(k)
      this.remote.set(target + k.slice(path.length), f)
    }
    for (const d of [...this.dirs]) {
      if (d === path || d.startsWith(path + '/')) {
        this.dirs.delete(d)
        this.dirs.add(target + d.slice(path.length))
      }
    }
    this.moves.push({ path, target })
  }
  async listAllFilesDetailed(dir: string): Promise<WebDavRemoteFile[]> {
    return [...this.remote.entries()]
      .filter(([p]) => p.startsWith(dir + '/'))
      .map(([path, f]) => ({ path, size: f.content.length, lastmod: f.lastmod }))
  }
  async downloadFile(path: string): Promise<string> {
    const f = this.remote.get(path)
    if (!f) throw new Error(`no such remote file: ${path}`)
    if (this.failDownloads.has(path)) throw new Error(`download rejected: ${path}`)
    this.downloads.push(path)
    return f.content.toString('utf-8')
  }
  async downloadToFile(path: string, localPath: string): Promise<void> {
    const f = this.remote.get(path)
    if (!f) throw new Error(`no such remote file: ${path}`)
    if (this.failDownloads.has(path)) throw new Error(`download rejected: ${path}`)
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

  it('parks removed remote files in the remote trash instead of deleting', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('ghost.md'), 'old', 'mod-1')
    await saveSyncState(dataRoot, {
      version: 1,
      files: { 'ghost.md': entry({ size: 3, mtimeMs: 123 }, { size: 3, lastmod: 'mod-1' }) }
    })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(fake.moves).toHaveLength(1)
    expect(fake.moves[0].path).toBe(R('ghost.md'))
    expect(fake.moves[0].target).toMatch(/^\/sophia\/\.trash\/[^/]+\/ghost\.md$/)
    expect(fake.deletions).toHaveLength(0)
    expect(result.trashed).toBe(1)
    expect(result.deleted).toBe(0)
  })

  it('leaves never-synced remote files untouched', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('alien.md'), 'not ours', 'mod-1')
    await saveSyncState(dataRoot, { version: 1, files: {} })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(fake.deletions).toHaveLength(0)
    expect(result.deleted).toBe(0)
  })

  it('first push with no state seeds from the remote listing and trashes extras', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('orphan.md'), 'junk from old full-uploads', 'mod-1')

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(fake.moves).toHaveLength(1)
    expect(fake.moves[0].path).toBe(R('orphan.md'))
    expect(result.trashed).toBe(1)
    expect(result.deleted).toBe(0)
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

  it('push trashes remote junk that is not in the sync set, even without a state record', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('sync-state.json'), '{"version":1}', 'mod-1')
    fake.setRemote(R('config/api.key.enc'), 'deadbeef', 'mod-2')
    fake.setRemote(R('alien.md'), 'valid but unknown — leave alone', 'mod-3')
    await saveSyncState(dataRoot, { version: 1, files: {} })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    // Junk is moved to the trash; the emptied /sophia/config directory
    // is pruned along the way. Unknown-but-valid files are untouched.
    expect(fake.moves.map((m) => m.path).sort()).toEqual(
      [R('config/api.key.enc'), R('sync-state.json')].sort()
    )
    expect(fake.deletions).toEqual([R('config')])
    expect(result.trashed).toBe(2)
    expect(result.deleted).toBe(0)
  })
})

describe('SyncManager — empty directory pruning', () => {
  it('pull removes local directories emptied by mirror deletion', async () => {
    const md = 'profiles/p/worlds/w/textbooks/tb_1/source.md'
    const pdf = 'profiles/p/worlds/w/textbooks/tb_1/source.pdf'
    await touch(md, 'md')
    await touch(pdf, 'pdf')
    await touch('profiles/p/worlds/w/textbooks/tb_2/keep.md', 'keep') // never synced
    const s1 = await localStat(md)
    const s2 = await localStat(pdf)
    await saveSyncState(dataRoot, {
      version: 1,
      files: {
        [md]: entry(s1, { size: 2, lastmod: 'm1' }),
        [pdf]: entry(s2, { size: 3, lastmod: 'm2' })
      }
    })
    const fake = new FakeClient() // remote side lost both files

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.deleted).toBe(2)
    // tb_1 is gone entirely — no empty husk left behind
    await expect(
      access(join(dataRoot, 'profiles', 'p', 'worlds', 'w', 'textbooks', 'tb_1'))
    ).rejects.toThrow()
    // non-empty directories and dataRoot itself survive
    expect(
      await readFile(join(dataRoot, 'profiles', 'p', 'worlds', 'w', 'textbooks', 'tb_2', 'keep.md'), 'utf-8')
    ).toBe('keep')
    await access(dataRoot)
  })

  it('push trashes remote files emptied by mirror deletion and prunes empty dirs, deepest first', async () => {
    const md = 'profiles/p/worlds/w/textbooks/tb_1/source.md'
    const pdf = 'profiles/p/worlds/w/textbooks/tb_1/source.pdf'
    const fake = new FakeClient()
    fake.setRemote(R(md), 'md', 'm1')
    fake.setRemote(R(pdf), 'pdf', 'm2')
    await saveSyncState(dataRoot, {
      version: 1,
      files: {
        [md]: entry({ size: 2, mtimeMs: 1 }, { size: 2, lastmod: 'm1' }),
        [pdf]: entry({ size: 3, mtimeMs: 2 }, { size: 3, lastmod: 'm2' })
      }
    })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    // Files go to the trash; the emptied directories are pruned.
    expect(result.trashed).toBe(2)
    expect(result.deleted).toBe(0)
    expect(fake.deletions).toContain(R('profiles/p/worlds/w/textbooks/tb_1'))
    expect(fake.deletions).toContain(R('profiles'))
    // the remote prefix itself is never a deletion candidate
    expect(fake.deletions).not.toContain('/sophia')
  })

  it('push keeps remote directories that still contain files', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('textbooks/a/source.md'), 'md', 'm1')
    fake.setRemote(R('textbooks/b/keep.md'), 'keep', 'm2') // unknown, left alone
    await saveSyncState(dataRoot, {
      version: 1,
      files: {
        'textbooks/a/source.md': entry({ size: 2, mtimeMs: 1 }, { size: 2, lastmod: 'm1' })
      }
    })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(result.trashed).toBe(1)
    expect(result.deleted).toBe(0)
    expect(fake.deletions).toContain(R('textbooks/a'))
    expect(fake.deletions).not.toContain(R('textbooks'))
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

describe('SyncManager — remote trash lifecycle', () => {
  it('prunes trash batches beyond the newest 3, oldest first', async () => {
    const fake = new FakeClient()
    for (let i = 1; i <= 5; i++) {
      fake.setRemote(`/sophia/.trash/2026-01-0${i}T00-00-00-000Z/file${i}.md`, 'x', `mod-${i}`)
    }
    await saveSyncState(dataRoot, { version: 1, files: {} })

    await makeManager(dataRoot, fake).push(CONFIG)

    // Batches are ISO timestamps → lexical sort == chronological order.
    // Newest 3 (03, 04, 05) stay; 01 and 02 are pruned.
    expect(fake.deletions).toEqual([
      '/sophia/.trash/2026-01-01T00-00-00-000Z',
      '/sophia/.trash/2026-01-02T00-00-00-000Z'
    ])
    expect(fake.hasRemote('/sophia/.trash/2026-01-03T00-00-00-000Z/file3.md')).toBe(true)
  })

  it('trash files are invisible to the sync set (never re-deleted as junk)', async () => {
    const fake = new FakeClient()
    fake.setRemote('/sophia/.trash/2026-01-01T00-00-00-000Z/old.md', 'x', 'mod-1')
    fake.setRemote(R('alien.md'), 'unknown but valid — leave alone', 'mod-2')
    await saveSyncState(dataRoot, { version: 1, files: {} })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(result.trashed).toBe(0)
    expect(fake.moves).toHaveLength(0)
    expect(fake.deletions).toHaveLength(0)
    expect(fake.hasRemote('/sophia/.trash/2026-01-01T00-00-00-000Z/old.md')).toBe(true)
  })

  it('listRemoteTrash reports batches, counts and sizes', async () => {
    const fake = new FakeClient()
    fake.setRemote('/sophia/.trash/2026-01-01T00-00-00-000Z/a.md', 'aaaa', 'mod-1')
    fake.setRemote('/sophia/.trash/2026-01-01T00-00-00-000Z/b.md', 'bb', 'mod-2')
    fake.setRemote('/sophia/.trash/2026-01-02T00-00-00-000Z/c.md', 'c', 'mod-3')

    const trash = await makeManager(dataRoot, fake).listRemoteTrash(CONFIG)

    expect(trash.batches).toHaveLength(2)
    expect(trash.fileCount).toBe(3)
    expect(trash.totalSize).toBe(7)
  })

  it('emptyRemoteTrash removes every batch', async () => {
    const fake = new FakeClient()
    fake.setRemote('/sophia/.trash/2026-01-01T00-00-00-000Z/a.md', 'x', 'mod-1')
    fake.setRemote('/sophia/.trash/2026-01-02T00-00-00-000Z/b.md', 'x', 'mod-2')

    const res = await makeManager(dataRoot, fake).emptyRemoteTrash(CONFIG)

    expect(res.success).toBe(true)
    expect(res.deletedBatches).toBe(2)
    expect(fake.remoteCount()).toBe(0)
  })
})

describe('SyncManager — pull safety', () => {
  it('preserves a local copy when both sides changed since the last sync', async () => {
    await touch('conv/messages.json', 'local version')
    const ls = await localStat('conv/messages.json')
    await saveSyncState(dataRoot, {
      version: 1,
      files: {
        'conv/messages.json': entry(
          { size: ls.size, mtimeMs: ls.mtimeMs - 1000 }, // recorded OLDER than actual → local changed
          { size: 5, lastmod: 'mod-1' }                    // remote also recorded, and differs below
        )
      }
    })
    const fake = new FakeClient()
    fake.setRemote(R('conv/messages.json'), 'remote version', 'mod-2')

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.success).toBe(true)
    expect(result.conflicts).toBe(1)
    expect(await readFile(join(dataRoot, 'conv/messages.json'), 'utf-8')).toBe('remote version')
    // The local version survives as a conflict sibling.
    const dir = join(dataRoot, 'conv')
    const names = (await readdir(dir)).filter((n) => n.startsWith('messages.conflict-'))
    expect(names).toHaveLength(1)
    expect(await readFile(join(dir, names[0]), 'utf-8')).toBe('local version')
  })

  it('leaves no temp files behind after a successful pull', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('a.md'), 'hello')
    fake.setRemote(R('b.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46]), 'mod-1')

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.success).toBe(true)
    expect(result.transferred).toBe(2)
    const leftover = (await walkLocal(dataRoot)).filter((p) => p.includes('.part-'))
    expect(leftover).toEqual([])
  })
})

async function walkLocal(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walkLocal(full)))
    else out.push(full)
  }
  return out
}

// ---------------------------------------------------------------------------
// Nested trash targets — parent collections must exist before MOVE
// ---------------------------------------------------------------------------

describe('SyncManager.push — nested trash targets', () => {
  class DirectoryStrictClient extends FakeClient {
    private ensuredDirs = new Set<string>()

    override async ensureDir(dir: string): Promise<void> {
      this.ensuredDirs.add(dir)
    }

    override async moveFile(path: string, target: string): Promise<void> {
      const parent = target.slice(0, target.lastIndexOf('/'))
      if (!this.ensuredDirs.has(parent)) {
        throw new Error(`WebDAV MOVE failed: parent collection missing: ${parent}`)
      }
      return super.moveFile(path, target)
    }
  }

  it('trashes nested files instead of falling back to permanent DELETE', async () => {
    const fake = new DirectoryStrictClient()
    const rel = 'conversations/c_1/artifacts/art_1.json'
    fake.setRemote(R(rel), '{}', 'mod-1')
    await saveSyncState(dataRoot, {
      version: 1,
      files: { [rel]: entry({ size: 2, mtimeMs: 123 }, { size: 2, lastmod: 'mod-1' }) }
    })

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(result.trashed).toBe(1)
    expect(result.deleted).toBe(0)
    // Empty-dir pruning may delete collections, but the file itself is moved.
    expect(fake.deletions).not.toContain(R(rel))
    expect(fake.moves[0].target).toMatch(
      /^\/sophia\/\.trash\/[^/]+\/conversations\/c_1\/artifacts\/art_1\.json$/
    )
  })
})

// ---------------------------------------------------------------------------
// Single-flight lock — mutating sync ops must not interleave
// ---------------------------------------------------------------------------

describe('SyncManager — single-flight lock', () => {
  class GatedClient extends FakeClient {
    private gate: Promise<void> | null = null
    private release: (() => void) | null = null

    arm(): void {
      this.gate = new Promise((resolve) => {
        this.release = resolve
      })
    }

    releaseGate(): void {
      this.release?.()
      this.release = null
    }

    override async listFiles(dir: string): Promise<WebDavFile[]> {
      if (this.gate) await this.gate
      return super.listFiles(dir)
    }
  }

  it('rejects a second op while the first is still running, then accepts new ones', async () => {
    const fake = new GatedClient()
    await touch('a.md', 'A')
    const manager = makeManager(dataRoot, fake)

    fake.arm()
    const first = manager.push(CONFIG)

    // Let the first push actually reach the gated remote listing.
    await new Promise((r) => setTimeout(r, 10))
    await expect(manager.pull(CONFIG)).rejects.toThrow(/同步正在进行中/)
    await expect(manager.push(CONFIG)).rejects.toThrow(/同步正在进行中/)
    await expect(manager.emptyRemoteTrash(CONFIG)).rejects.toThrow(/同步正在进行中/)

    fake.releaseGate()
    await expect(first).resolves.toMatchObject({ success: true })

    // Lock released: the next run is accepted.
    const after = await manager.pull(CONFIG)
    expect(after.success).toBe(true)
  })

  it('releases the lock after a failing run', async () => {
    class FailOnceClient extends FakeClient {
      private failed = false
      override async listAllFilesDetailed(dir: string): Promise<WebDavRemoteFile[]> {
        if (!this.failed) {
          this.failed = true
          throw new Error('boom')
        }
        return super.listAllFilesDetailed(dir)
      }
    }

    const fake = new FailOnceClient()
    await touch('a.md', 'A')
    const manager = makeManager(dataRoot, fake)

    await expect(manager.push(CONFIG)).rejects.toThrow('boom')
    // The failure must not leave the lock stuck.
    const result = await manager.push(CONFIG)
    expect(result.success).toBe(true)
  })
})

describe('SyncManager — error and safety branches', () => {
  it('reports upload failures per file and keeps going', async () => {
    const fake = new FakeClient()
    await touch('a.md', 'A')
    await touch('b.md', 'B')
    fake.failUploads.add(R('a.md'))

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(result.success).toBe(false)
    expect(result.transferred).toBe(1)
    expect(result.errors).toEqual([expect.stringContaining('upload rejected')])
    expect(fake.uploads.map((u) => u.path)).toEqual([R('b.md')])
  })

  it('falls back to DELETE when moving a file to the trash fails', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('junk.md'), 'x', 'mod-1')
    await saveSyncState(dataRoot, { version: 1, files: { 'junk.md': entry(null, { size: 1, lastmod: 'mod-1' }) } })
    fake.failMoves.add(R('junk.md'))

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(result.trashed).toBe(0)
    expect(result.deleted).toBe(1)
    expect(fake.deletions).toContain(R('junk.md'))
  })

  it('reports a file when both the trash move and the delete fail', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('junk.md'), 'x', 'mod-1')
    await saveSyncState(dataRoot, { version: 1, files: { 'junk.md': entry(null, { size: 1, lastmod: 'mod-1' }) } })
    fake.failMoves.add(R('junk.md'))
    fake.failDeletes.add(R('junk.md'))

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(result.success).toBe(false)
    expect(result.errors).toEqual([expect.stringContaining('delete rejected')])
  })

  it('reports download failures and leaves no temp file behind', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('a.md'), 'content')
    fake.failDownloads.add(R('a.md'))

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.success).toBe(false)
    expect(result.errors).toEqual([expect.stringContaining('download rejected')])
    const files = await readdir(dataRoot)
    expect(files.filter((f) => f.includes('.part-'))).toHaveLength(0)
  })

  it('reports local deletions that cannot be removed', async () => {
    // A directory where the state expects a file → rm(force) refuses it.
    await mkdir(join(dataRoot, 'profiles', 'ghost'), { recursive: true })
    const s = await stat(join(dataRoot, 'profiles', 'ghost'))
    await saveSyncState(dataRoot, {
      version: 1,
      files: { 'profiles/ghost': entry({ size: s.size, mtimeMs: s.mtimeMs }, { size: 1, lastmod: 'mod-1' }) }
    })
    const fake = new FakeClient()

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.success).toBe(false)
    expect(result.errors).toEqual([expect.stringContaining('profiles/ghost')])
  })

  it('refuses empty, drive-lettered and state-recorded unsafe paths', async () => {
    const fake = new FakeClient()
    fake.setRemote('/sophia/', 'ignored')
    fake.setRemote('/sophia/C:/windows', 'ignored')
    fake.setRemote(R('ok.md'), 'fine')
    await saveSyncState(dataRoot, {
      version: 1,
      files: { '../escape.txt': entry(null, { size: 1, lastmod: 'mod-x' }) }
    })

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.errors.filter((e) => e.includes('unsafe remote path')).length).toBe(2)
    expect(result.transferred).toBe(1)
    await expect(access(join(parentDir, 'escape.txt'))).rejects.toThrow()
  })

  it('does not seed junk remote files into a fresh push state', async () => {
    const fake = new FakeClient()
    fake.setRemote(R('sync-state.json'), '{"version":1}', 'mod-1')
    fake.setRemote(R('keep.md'), 'valid', 'mod-2')
    await touch('keep.md', 'valid')

    const result = await makeManager(dataRoot, fake).push(CONFIG)

    // Junk is trashed; the valid file stays and is recorded in state.
    expect(result.trashed).toBe(1)
    const state = JSON.parse(await readFile(join(dataRoot, 'sync-state.json'), 'utf-8')) as {
      files: Record<string, unknown>
    }
    expect(Object.keys(state.files)).toEqual(['keep.md'])
  })

  it('rotates old pre-sync backups keeping only the newest three', async () => {
    const fake = new FakeClient()
    await touch('a.md', 'A')
    const cacheDir = join(dataRoot, '.sync-cache')
    for (let i = 0; i < 5; i++) {
      await mkdir(join(cacheDir, `backup_2026-01-0${i + 1}T00-00-00-000Z`), { recursive: true })
    }
    // Non-backup entries in the cache dir are ignored by the rotation.
    await writeFile(join(cacheDir, 'notes.txt'), 'keep me')

    await makeManager(dataRoot, fake).push(CONFIG)

    const backups = (await readdir(cacheDir)).filter((e) => e.startsWith('backup_'))
    expect(backups).toHaveLength(3)
    expect(await readFile(join(cacheDir, 'notes.txt'), 'utf-8')).toBe('keep me')
  })

  it('keeps pruning when a parent directory is already gone', async () => {
    // Two deletions whose parent chain overlaps: the second start is removed
    // by the first pass, so its readdir fails and pruning stops cleanly.
    await touch('profiles/a/deep/b.md', 'B')
    await touch('profiles/a.md', 'A')
    const deep = await localStat('profiles/a/deep/b.md')
    const top = await localStat('profiles/a.md')
    await saveSyncState(dataRoot, {
      version: 1,
      files: {
        'profiles/a/deep/b.md': entry(deep, { size: 1, lastmod: 'mod-1' }),
        'profiles/a.md': entry(top, { size: 1, lastmod: 'mod-2' })
      }
    })
    const fake = new FakeClient()

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.success).toBe(true)
    expect(result.deleted).toBe(2)
    await expect(access(join(dataRoot, 'profiles'))).rejects.toThrow()
  })

  it('lists and empties the remote trash while ignoring stray files', async () => {
    const fake = new FakeClient()
    fake.setRemote('/sophia/.trash/stray.md', 'not a batch')
    fake.setRemote('/sophia/.trash/batch-1/a.md', 'x')
    fake.setRemote('/sophia/.trash/batch-1/b.md', 'y')

    const manager = makeManager(dataRoot, fake)
    const trash = await manager.listRemoteTrash(CONFIG)
    expect(trash.batches.map((b) => b.name)).toEqual(['batch-1'])
    expect(trash.fileCount).toBe(2)

    const cleared = await manager.emptyRemoteTrash(CONFIG)
    expect(cleared).toEqual({ success: true, deletedBatches: 1 })
    expect(fake.hasRemote('/sophia/.trash/stray.md')).toBe(true)
  })

  it('answers a connectivity probe through the real client timeout path', async () => {
    const manager = new SyncManager(dataRoot)
    const result = await manager.test({
      url: 'http://127.0.0.1:9/dav',
      username: 'u',
      password: 'p'
    })
    expect(result.success).toBe(false)
  }, 30_000)
})


