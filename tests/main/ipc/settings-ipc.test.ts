/**
 * settings.ts IPC — the DeepSeek API-key handlers and the safeStorage adapter
 * delegation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
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

import { registerSettingsIpc } from '../../../src/main/ipc/settings'

let dataRoot = ''
const safeStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((plaintext: string) => Buffer.from(`enc:${plaintext}`)),
  decryptString: vi.fn((encrypted: Buffer) => encrypted.toString('utf-8').replace(/^enc:/, ''))
}

async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return (await handler({}, input)) as T
}

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-settings-'))
  mocks.handlers.clear()
  safeStorage.isEncryptionAvailable.mockClear()
  safeStorage.encryptString.mockClear()
  safeStorage.decryptString.mockClear()
  registerSettingsIpc(dataRoot, safeStorage as never)
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('settings IPC — DeepSeek key', () => {
  it('sets, reports and deletes the key through encrypted storage', async () => {
    await expect(invoke('settings:has-deepseek-key')).resolves.toBe(false)

    await expect(invoke('settings:set-deepseek-key', { key: 'sk-live' })).resolves.toBeUndefined()
    expect(safeStorage.encryptString).toHaveBeenCalledWith('sk-live')

    await expect(invoke('settings:has-deepseek-key')).resolves.toBe(true)

    await expect(invoke('settings:delete-deepseek-key')).resolves.toBeUndefined()
    await expect(invoke('settings:has-deepseek-key')).resolves.toBe(false)
  })

  it('validates the key payload', async () => {
    await expect(invoke('settings:set-deepseek-key', { key: '' })).rejects.toThrow()
    await expect(invoke('settings:set-deepseek-key', {})).rejects.toThrow()
  })
})
