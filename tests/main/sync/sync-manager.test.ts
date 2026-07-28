import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SyncManager, type SyncProgress } from '../../../src/main/sync/sync-manager'
import type { WebDavConfig } from '../../../src/main/sync/webdav-client'

const CONFIG: WebDavConfig = { url: 'https://example.com/dav', username: 'u', password: 'p' }

/** In-memory stand-in for SyncWebDavClient — records calls, serves canned data. */
class FakeClient {
  uploads: { path: string; content: string | Buffer }[] = []
  ensuredDirs: string[] = []
  remoteFiles: string[] = []
  remoteContents = new Map<string, string>()
  remoteBuffers = new Map<string, Buffer>()

  async uploadFile(path: string, content: string | Buffer): Promise<void> {
    this.uploads.push({ path, content })
  }
  async ensureDir(dir: string): Promise<void> {
    this.ensuredDirs.push(dir)
  }
  async listAllFiles(_dir: string): Promise<string[]> {
    return this.remoteFiles
  }
  async downloadFile(path: string): Promise<string> {
    const content = this.remoteContents.get(path)
    if (content === undefined) throw new Error(`no such remote file: ${path}`)
    return content
  }
  async downloadFileBuffer(path: string): Promise<Buffer> {
    const content = this.remoteBuffers.get(path)
    if (content === undefined) throw new Error(`no such remote file: ${path}`)
    return content
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

describe('SyncManager.push', () => {
  it('uploads files under the /sophia remote prefix', async () => {
    const storyPath = join('profiles', 'prof_default', 'worlds', 'world_default', 'story.md')
    await mkdir(join(dataRoot, 'profiles', 'prof_default', 'worlds', 'world_default'), {
      recursive: true
    })
    await writeFile(join(dataRoot, storyPath), '# story', 'utf-8')

    const fake = new FakeClient()
    const result = await makeManager(dataRoot, fake).push(CONFIG)

    expect(result.success).toBe(true)
    expect(fake.uploads).toHaveLength(1)
    expect(fake.uploads[0].path).toBe(
      '/sophia/profiles/prof_default/worlds/world_default/story.md'
    )
  })

  it('pushes and pulls through the same remote path layout', async () => {
    // Push must write where pull reads, otherwise sync is a silent no-op.
    const storyPath = join('profiles', 'prof_default', 'worlds', 'world_default', 'story.md')
    await mkdir(join(dataRoot, 'profiles', 'prof_default', 'worlds', 'world_default'), {
      recursive: true
    })
    await writeFile(join(dataRoot, storyPath), '# story', 'utf-8')

    const fake = new FakeClient()
    await makeManager(dataRoot, fake).push(CONFIG)

    // Simulate the server echoing back exactly what was uploaded
    const uploadPath = fake.uploads[0].path
    expect(uploadPath.startsWith('/sophia/')).toBe(true)

    await rm(join(dataRoot, storyPath))
    fake.remoteFiles = [uploadPath]
    fake.remoteContents.set(uploadPath, '# story')

    const pullResult = await makeManager(dataRoot, fake).pull(CONFIG)
    expect(pullResult.count).toBe(1)
    expect(await readFile(join(dataRoot, storyPath), 'utf-8')).toBe('# story')
  })
})

describe('SyncManager.pull', () => {
  it('writes remote files into dataRoot after stripping the /sophia prefix', async () => {
    const fake = new FakeClient()
    fake.remoteFiles = ['/sophia/profiles/prof_default/profile.json']
    fake.remoteContents.set('/sophia/profiles/prof_default/profile.json', '{"id":"x"}')

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.success).toBe(true)
    expect(result.count).toBe(1)
    expect(
      await readFile(join(dataRoot, 'profiles', 'prof_default', 'profile.json'), 'utf-8')
    ).toBe('{"id":"x"}')
  })

  it('refuses server paths that escape dataRoot via .. segments', async () => {
    const fake = new FakeClient()
    fake.remoteFiles = ['/sophia/../evil.txt']
    fake.remoteContents.set('/sophia/../evil.txt', 'pwned')

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.count).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
    // evil.txt must NOT have been written next to dataRoot
    await expect(access(join(parentDir, 'evil.txt'))).rejects.toThrow()
  })

  it('refuses absolute server paths', async () => {
    const fake = new FakeClient()
    fake.remoteFiles = ['/sophia//etc/passwd']
    fake.remoteContents.set('/sophia//etc/passwd', 'root:x:0:0')

    const result = await makeManager(dataRoot, fake).pull(CONFIG)

    expect(result.count).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('SyncManager — binary files (.pdf)', () => {
  const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80, 0x7f, 0x0a, 0x0d])

  it('pushes .pdf files as binary and pulls them back byte-identical', async () => {
    const relPdf = join(
      'profiles', 'prof_default', 'worlds', 'world_default',
      'textbooks', 'tb_1', 'source.pdf'
    )
    await mkdir(join(dataRoot, 'profiles', 'prof_default', 'worlds', 'world_default', 'textbooks', 'tb_1'), { recursive: true })
    await writeFile(join(dataRoot, relPdf), PDF_BYTES)

    const fake = new FakeClient()
    await makeManager(dataRoot, fake).push(CONFIG)

    expect(fake.uploads).toHaveLength(1)
    expect(fake.uploads[0].path).toBe('/sophia/profiles/prof_default/worlds/world_default/textbooks/tb_1/source.pdf')
    // Content must be the raw bytes, not a utf-8-decoded string
    const uploaded = fake.uploads[0].content
    const uploadedBuf = Buffer.isBuffer(uploaded) ? uploaded : Buffer.from(uploaded as string, 'utf-8')
    expect(uploadedBuf.equals(PDF_BYTES)).toBe(true)

    // Round-trip: pull into a fresh dataRoot
    await rm(join(dataRoot, relPdf))
    fake.remoteFiles = [fake.uploads[0].path]
    fake.remoteBuffers.set(fake.uploads[0].path, uploadedBuf)

    const result = await makeManager(dataRoot, fake).pull(CONFIG)
    expect(result.count).toBe(1)

    const pulled = await readFile(join(dataRoot, relPdf))
    expect(pulled.equals(PDF_BYTES)).toBe(true)
  })
})

describe('SyncManager — progress reporting', () => {
  it('reports progress for each pushed file', async () => {
    for (const name of ['a.md', 'b.md']) {
      await writeFile(join(dataRoot, name), `# ${name}`, 'utf-8')
    }
    const events: SyncProgress[] = []
    const fake = new FakeClient()

    await makeManager(dataRoot, fake).push(CONFIG, (p) => events.push(p))

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ direction: 'push', current: 1, total: 2 })
    expect(events[1]).toMatchObject({ direction: 'push', current: 2, total: 2 })
    // file names are relative paths so the UI can show what is happening
    expect(events.map((e) => e.file).sort()).toEqual(['a.md', 'b.md'])
  })

  it('reports progress for each pulled file', async () => {
    const fake = new FakeClient()
    fake.remoteFiles = ['/sophia/x.md', '/sophia/y.md']
    fake.remoteContents.set('/sophia/x.md', 'x')
    fake.remoteContents.set('/sophia/y.md', 'y')
    const events: SyncProgress[] = []

    await makeManager(dataRoot, fake).pull(CONFIG, (p) => events.push(p))

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ direction: 'pull', current: 1, total: 2, file: 'x.md' })
    expect(events[1]).toMatchObject({ direction: 'pull', current: 2, total: 2, file: 'y.md' })
  })

  it('keeps reporting progress for later files when one file fails', async () => {
    const fake = new FakeClient()
    fake.remoteFiles = ['/sophia/missing.md', '/sophia/ok.md']
    fake.remoteContents.set('/sophia/ok.md', 'ok')
    const events: SyncProgress[] = []

    const result = await makeManager(dataRoot, fake).pull(CONFIG, (p) => events.push(p))

    expect(result.success).toBe(false)
    expect(events).toHaveLength(2)
    expect(events[1].current).toBe(2)
  })
})
