/**
 * ProviderStore — provider CRUD plus encrypted API-key handling on a temp
 * data root (no electron: a fake safeStorage adapter stands in for it).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProviderStore } from '../../../src/main/storage/provider-store'
import { configDir } from '../../../src/main/storage/app-data'
import type { SafeStorageAdapter } from '../../../src/main/security/secure-key-store'

const safeStorage: SafeStorageAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext: string) => Buffer.from(`enc:${plaintext}`, 'utf8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf8').replace(/^enc:/, '')
}

let dataRoot = ''
let store: ProviderStore

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-providers-'))
  store = new ProviderStore(dataRoot, safeStorage)
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('ProviderStore — providers', () => {
  it('creates providers with defaults and reads them back', async () => {
    const created = await store.create({
      name: 'DeepSeek',
      type: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-one',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro']
    })

    expect(created.id).toMatch(/^prov_/)
    expect(created.selectedModel).toBe('deepseek-v4-flash')
    expect(created.isActive).toBe(false)

    const list = await store.list()
    expect(list).toHaveLength(1)
    await expect(store.get(created.id)).resolves.toMatchObject({ name: 'DeepSeek' })
    await expect(store.get('prov_missing')).resolves.toBeNull()
    // Nothing is active until explicitly set.
    await expect(store.getActive()).resolves.toBeNull()
  })

  it('updates providers and keeps a single active provider', async () => {
    const a = await store.create({ name: 'A', type: 'deepseek', baseUrl: 'u', apiKey: 'k' })
    const b = await store.create({ name: 'B', type: 'custom', baseUrl: 'u2', apiKey: 'k2' })

    const updated = await store.update(a.id, { name: 'A2', isActive: true })
    expect(updated?.name).toBe('A2')
    await expect(store.getActive()).resolves.toMatchObject({ id: a.id })

    await store.update(b.id, { isActive: true })
    const list = await store.list()
    expect(list.find((p) => p.id === a.id)?.isActive).toBe(false)
    await expect(store.getActive()).resolves.toMatchObject({ id: b.id })

    await expect(store.update('prov_missing', { name: 'x' })).resolves.toBeNull()
  })

  it('updates the connection fields', async () => {
    const created = await store.create({ name: 'A', type: 'deepseek', baseUrl: 'u', apiKey: 'k' })

    const updated = await store.update(created.id, {
      type: 'custom',
      baseUrl: 'https://new.example.com/v1',
      models: ['m1', 'm2'],
      selectedModel: 'm2'
    })

    expect(updated).toMatchObject({
      type: 'custom',
      baseUrl: 'https://new.example.com/v1',
      models: ['m1', 'm2'],
      selectedModel: 'm2'
    })
  })

  it('deletes providers and their key material', async () => {
    const created = await store.create({ name: 'A', type: 'deepseek', baseUrl: 'u', apiKey: 'k' })
    await expect(store.hasApiKey(created.id)).resolves.toBe(true)

    await expect(store.delete(created.id)).resolves.toBe(true)
    await expect(store.hasApiKey(created.id)).resolves.toBe(false)
    await expect(store.list()).resolves.toEqual([])
    await expect(store.delete(created.id)).resolves.toBe(false)
  })

  it('returns [] for a corrupted providers.json instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mkdir(configDir(dataRoot), { recursive: true })
    await writeFile(join(configDir(dataRoot), 'providers.json'), '{ not json', 'utf-8')

    await expect(store.list()).resolves.toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('ProviderStore — API keys', () => {
  it('encrypts keys on disk and never stores plaintext', async () => {
    const created = await store.create({ name: 'A', type: 'deepseek', baseUrl: 'u', apiKey: 'sk-secret' })

    await expect(store.readApiKey(created.id)).resolves.toBe('sk-secret')
    const raw = await readFile(join(configDir(dataRoot), `${created.id}.key.enc`), 'utf-8')
    expect(raw).toBe('enc:sk-secret')
    expect(raw).not.toBe('sk-secret')
  })

  it('rejects path-traversal provider ids and returns null/false safely', async () => {
    await expect(store.setApiKey('../escape', 'sk')).rejects.toThrow('Invalid provider id')
    await expect(store.readApiKey('../escape')).resolves.toBeNull()
    await expect(store.hasApiKey('../escape')).resolves.toBe(false)
    await expect(store.deleteApiKey('../escape')).resolves.toBeUndefined()
  })

  it('throws when OS encryption is unavailable', async () => {
    const unavailable: SafeStorageAdapter = { ...safeStorage, isEncryptionAvailable: () => false }
    const blocked = new ProviderStore(dataRoot, unavailable)
    await expect(
      blocked.setApiKey('prov_1', 'sk')
    ).rejects.toThrow('Encryption is not available')
  })

  it('treats missing or unreadable key files as absent', async () => {
    await expect(store.readApiKey('prov_none')).resolves.toBeNull()

    // A key file that cannot be decrypted is reported as missing, not fatal.
    await mkdir(configDir(dataRoot), { recursive: true })
    await writeFile(join(configDir(dataRoot), 'prov_bad.key.enc'), Buffer.from([0xff, 0xfe]))
    const failing: SafeStorageAdapter = {
      ...safeStorage,
      decryptString: () => {
        throw new Error('cannot decrypt')
      }
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tolerant = new ProviderStore(dataRoot, failing)
    await expect(tolerant.readApiKey('prov_bad')).resolves.toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
