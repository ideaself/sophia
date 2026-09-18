/**
 * providers.ts IPC — provider CRUD through the bridge, encrypted key
 * handling and the /models HTTP helpers (fetch stubbed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

type Handler = (event: unknown, input?: unknown) => Promise<unknown>

const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      mocks.handlers.set(channel, fn)
    }
  }
}))

import { registerProviderIpc } from '../../../src/main/ipc/providers'
import { configDir } from '../../../src/main/storage/app-data'
import type { SafeStorageAdapter } from '../../../src/main/security/secure-key-store'

const fakeSafeStorage: SafeStorageAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext: string) => Buffer.from(`enc:${plaintext}`, 'utf8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf8').replace(/^enc:/, '')
}

let dataRoot = ''
let fetchMock: ReturnType<typeof vi.fn>

async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return (await handler({}, input)) as T
}

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-prov-ipc-'))
  mocks.handlers.clear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  registerProviderIpc(dataRoot, fakeSafeStorage)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(dataRoot, { recursive: true, force: true })
})

describe('providers IPC — CRUD', () => {
  it('creates, lists, reads, updates, activates and deletes providers', async () => {
    const created = await invoke<{ id: string; name: string }>('providers:create', {
      name: 'DeepSeek',
      type: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-one',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro']
    })
    expect(created.name).toBe('DeepSeek')

    await expect(invoke('providers:get', { id: created.id })).resolves.toMatchObject({
      id: created.id
    })
    await expect(invoke('providers:get', { id: 'prov_missing' })).resolves.toBeNull()
    await expect(invoke('providers:get-active')).resolves.toBeNull()
    await expect(invoke<unknown[]>('providers:list')).resolves.toHaveLength(1)

    await expect(
      invoke('providers:update', { id: created.id, name: 'DeepSeek 主号' })
    ).resolves.toMatchObject({ name: 'DeepSeek 主号' })

    await expect(invoke('providers:set-active', { id: created.id })).resolves.toMatchObject({
      isActive: true
    })
    await expect(invoke('providers:get-active')).resolves.toMatchObject({ id: created.id })

    await expect(invoke('providers:delete', { id: created.id })).resolves.toBe(true)
    await expect(invoke<unknown[]>('providers:list')).resolves.toEqual([])
  })

  it('validates ids and payloads on the IPC boundary', async () => {
    await expect(invoke('providers:get', { id: '../escape' })).rejects.toThrow()
    await expect(
      invoke('providers:create', { name: '', type: 'deepseek', baseUrl: 'x', apiKey: 'k' })
    ).rejects.toThrow()
  })
})

describe('providers IPC — API keys', () => {
  it('stores keys encrypted and reports presence', async () => {
    const provider = await invoke<{ id: string }>('providers:create', {
      name: 'DeepSeek',
      type: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-secret'
    })

    await expect(invoke('providers:has-api-key', { id: provider.id })).resolves.toBe(true)
    expect(await readFile(join(configDir(dataRoot), `${provider.id}.key.enc`), 'utf-8')).toBe(
      'enc:sk-secret'
    )

    await invoke('providers:set-api-key', { id: provider.id, apiKey: 'sk-rotated' })
    expect(await readFile(join(configDir(dataRoot), `${provider.id}.key.enc`), 'utf-8')).toBe(
      'enc:sk-rotated'
    )

    await invoke('providers:delete', { id: provider.id })
    await expect(invoke('providers:has-api-key', { id: provider.id })).resolves.toBe(false)
  })
})

describe('providers IPC — models endpoint', () => {
  const okResponse = (ids: string[]): unknown => ({
    ok: true,
    json: async () => ({ data: ids.map((id) => ({ id })) })
  })

  it('fetches model ids from the endpoint', async () => {
    fetchMock.mockResolvedValue(okResponse(['deepseek-v4-flash', 'deepseek-v4-pro']))

    const models = await invoke<string[]>('providers:fetch-models', {
      baseUrl: 'https://api.example.com/',
      apiKey: 'sk-x'
    })

    expect(models).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/models',
      expect.objectContaining({ method: 'GET' })
    )
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers.Authorization).toBe('Bearer sk-x')
  })

  it('rejects insecure endpoints and HTTP errors', async () => {
    await expect(
      invoke('providers:fetch-models', { baseUrl: 'http://api.example.com', apiKey: 'k' })
    ).rejects.toThrow(/https/i)

    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })
    await expect(
      invoke('providers:fetch-models', { baseUrl: 'https://api.example.com', apiKey: 'k' })
    ).rejects.toThrow(/Failed to fetch models: 500/)

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ nope: true }) })
    await expect(
      invoke('providers:fetch-models', { baseUrl: 'https://api.example.com', apiKey: 'k' })
    ).rejects.toThrow(/Invalid response format/)
  })

  it('tests connections with a models summary', async () => {
    fetchMock.mockResolvedValue(okResponse(['m1', 'm2']))
    await expect(
      invoke('providers:test-connection', { baseUrl: 'https://api.example.com', apiKey: 'k' })
    ).resolves.toEqual({ success: true, models: ['m1', 'm2'], message: 'Found 2 models' })

    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' })
    await expect(
      invoke('providers:test-connection', { baseUrl: 'https://api.example.com', apiKey: 'bad' })
    ).resolves.toEqual({ success: false, error: 'HTTP 401: Unauthorized' })

    fetchMock.mockRejectedValue(new Error('network down'))
    await expect(
      invoke('providers:test-connection', { baseUrl: 'https://api.example.com', apiKey: 'k' })
    ).resolves.toEqual({ success: false, error: 'network down' })
  })

  it('treats a payload without a data array as zero models', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    await expect(
      invoke('providers:test-connection', { baseUrl: 'https://api.example.com', apiKey: 'k' })
    ).resolves.toEqual({ success: true, models: [], message: 'Found 0 models' })
  })

  it('reports non-Error connection failures as an unknown error', async () => {
    fetchMock.mockRejectedValue('raw transport failure')
    await expect(
      invoke('providers:test-connection', { baseUrl: 'https://api.example.com', apiKey: 'k' })
    ).resolves.toEqual({ success: false, error: 'Unknown error' })
  })

  it('returns validation errors instead of throwing for bad input', async () => {
    await expect(invoke('providers:test-connection', { baseUrl: '', apiKey: '' })).resolves.toEqual(
      expect.objectContaining({ success: false })
    )
    await expect(
      invoke('providers:test-connection', { baseUrl: 'http://insecure', apiKey: 'k' })
    ).resolves.toEqual({ success: false, error: expect.stringMatching(/https/i) })
  })
})
