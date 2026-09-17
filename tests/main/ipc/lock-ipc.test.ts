/**
 * lock.ts IPC — profile PIN stored encrypted via safeStorage; only the
 * adapter's delegation boundary is exercised here (the secure key store has
 * its own tests).
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

import { registerLockIpc } from '../../../src/main/ipc/lock'

let dataRoot = ''
const safeStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((plaintext: string) => Buffer.from(`enc:${plaintext}`)),
  decryptString: vi.fn((encrypted: Buffer) =>
    encrypted.toString('utf-8').replace(/^enc:/, '')
  )
}

async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return (await handler({}, input)) as T
}

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-lock-'))
  mocks.handlers.clear()
  safeStorage.isEncryptionAvailable.mockClear()
  safeStorage.encryptString.mockClear()
  safeStorage.decryptString.mockClear()
  registerLockIpc(dataRoot, safeStorage as unknown as Electron.SafeStorage)
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('lock IPC', () => {
  it('reports, verifies and clears the PIN', async () => {
    await expect(invoke('lock:has')).resolves.toBe(false)

    await expect(invoke('lock:set', { pin: '1234' })).resolves.toEqual({ success: true })
    expect(safeStorage.isEncryptionAvailable).toHaveBeenCalled()
    expect(safeStorage.encryptString).toHaveBeenCalledWith('1234')

    await expect(invoke('lock:has')).resolves.toBe(true)
    await expect(invoke('lock:verify', { pin: '1234' })).resolves.toBe(true)
    await expect(invoke('lock:verify', { pin: '0000' })).resolves.toBe(false)

    await expect(invoke('lock:clear')).resolves.toEqual({ success: true })
    await expect(invoke('lock:has')).resolves.toBe(false)
  })

  it('refuses a verify when no PIN was ever set', async () => {
    await expect(invoke('lock:verify', { pin: '1234' })).resolves.toBe(false)
    expect(safeStorage.decryptString).not.toHaveBeenCalled()
  })

  it('validates the input payloads', async () => {
    await expect(invoke('lock:set', { pin: '12' })).rejects.toThrow()
    await expect(invoke('lock:set', {})).rejects.toThrow()
    await expect(invoke('lock:verify', { pin: '' })).rejects.toThrow()
  })
})
