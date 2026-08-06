import { readFile, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { configDir } from './app-data'
import { isNotFoundError, warnReadFailure } from './fs-errors'
import { atomicWriteFile } from './atomic-write'
import type { SafeStorageAdapter } from '../security/secure-key-store'

const PROVIDERS_FILE = 'providers.json'

export interface ApiProvider {
  id: string
  name: string
  type: 'deepseek' | 'mimo' | 'custom'
  baseUrl: string
  models: string[]
  selectedModel: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

let idCounter = 0

function generateId(): string {
  idCounter += 1
  return `prov_${Date.now()}_${idCounter}`
}

export class ProviderStore {
  private providersPath: string

  constructor(
    private readonly dataRoot: string,
    private readonly safeStorage: SafeStorageAdapter
  ) {
    this.providersPath = join(configDir(dataRoot), PROVIDERS_FILE)
  }

  async list(): Promise<ApiProvider[]> {
    try {
      const content = await readFile(this.providersPath, 'utf-8')
      return JSON.parse(content) as ApiProvider[]
    } catch (err) {
      // Must log: list() returning [] on corruption also feeds create(),
      // which would then overwrite the file and lose every provider.
      if (!isNotFoundError(err)) warnReadFailure('providers.json', err)
      return []
    }
  }

  async get(id: string): Promise<ApiProvider | null> {
    const providers = await this.list()
    return providers.find((p) => p.id === id) ?? null
  }

  async getActive(): Promise<ApiProvider | null> {
    const providers = await this.list()
    return providers.find((p) => p.isActive) ?? null
  }

  async create(input: {
    name: string
    type: ApiProvider['type']
    baseUrl: string
    apiKey: string
    models?: string[]
    selectedModel?: string
  }): Promise<ApiProvider> {
    const now = new Date().toISOString()
    const provider: ApiProvider = {
      id: generateId(),
      name: input.name,
      type: input.type,
      baseUrl: input.baseUrl,
      models: input.models ?? [],
      selectedModel: input.selectedModel ?? (input.models?.[0] ?? ''),
      isActive: false,
      createdAt: now,
      updatedAt: now
    }

    const providers = await this.list()
    providers.push(provider)
    await this.save(providers)

    // Encrypt and store API key
    await this.setApiKey(provider.id, input.apiKey)

    return provider
  }

  async update(
    id: string,
    updates: Partial<Pick<ApiProvider, 'name' | 'type' | 'baseUrl' | 'models' | 'selectedModel' | 'isActive'>>
  ): Promise<ApiProvider | null> {
    const providers = await this.list()
    const idx = providers.findIndex((p) => p.id === id)
    if (idx === -1) return null

    const provider = providers[idx]
    if (updates.name !== undefined) provider.name = updates.name
    if (updates.type !== undefined) provider.type = updates.type
    if (updates.baseUrl !== undefined) provider.baseUrl = updates.baseUrl
    if (updates.models !== undefined) provider.models = updates.models
    if (updates.selectedModel !== undefined) provider.selectedModel = updates.selectedModel
    if (updates.isActive !== undefined) {
      provider.isActive = updates.isActive
      // Deactivate all others if this one is being activated
      if (updates.isActive) {
        for (const p of providers) {
          if (p.id !== id) p.isActive = false
        }
      }
    }
    provider.updatedAt = new Date().toISOString()

    await this.save(providers)
    return provider
  }

  async delete(id: string): Promise<boolean> {
    const providers = await this.list()
    const filtered = providers.filter((p) => p.id !== id)
    if (filtered.length === providers.length) return false

    await this.save(filtered)
    await this.deleteApiKey(id)
    return true
  }

  // --- API Key management ---

  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption is not available on this system')
    }
    const dir = configDir(this.dataRoot)
    await mkdir(dir, { recursive: true })
    const encrypted = this.safeStorage.encryptString(apiKey)
    await atomicWriteFile(join(dir, `${providerId}.key.enc`), encrypted)
  }

  async readApiKey(providerId: string): Promise<string | null> {
    try {
      const encrypted = await readFile(join(configDir(this.dataRoot), `${providerId}.key.enc`))
      return this.safeStorage.decryptString(encrypted)
    } catch (err) {
      if (!isNotFoundError(err)) warnReadFailure(`API key for provider ${providerId}`, err)
      return null
    }
  }

  async hasApiKey(providerId: string): Promise<boolean> {
    try {
      await access(join(configDir(this.dataRoot), `${providerId}.key.enc`))
      return true
    } catch {
      return false
    }
  }

  async deleteApiKey(providerId: string): Promise<void> {
    try {
      const { unlink } = await import('node:fs/promises')
      await unlink(join(configDir(this.dataRoot), `${providerId}.key.enc`))
    } catch {
      // File doesn't exist — that's fine
    }
  }

  // --- Private ---

  private async save(providers: ApiProvider[]): Promise<void> {
    const dir = configDir(this.dataRoot)
    await mkdir(dir, { recursive: true })
    await atomicWriteFile(this.providersPath, JSON.stringify(providers, null, 2), 'utf-8')
  }
}
