import { ipcMain } from 'electron'
import { ProviderStore } from '../storage/provider-store'
import type { SafeStorageAdapter } from '../security/secure-key-store'
import { assertHttpsEndpoint } from '../llm/endpoint'

/** Timeout for provider discovery/connectivity probes. */
const PROVIDER_REQUEST_TIMEOUT_MS = 15_000

/**
 * Register IPC handlers for API provider management.
 *
 * Handles:
 * - `providers:list` — list all providers
 * - `providers:create` — create a new provider
 * - `providers:update` — update a provider
 * - `providers:delete` — delete a provider
 * - `providers:get-active` — get the active provider
 * - `providers:set-active` — set a provider as active
 * - `providers:set-api-key` — set/update API key for a provider
 * - `providers:has-api-key` — check if a provider has an API key
 * - `providers:fetch-models` — fetch available models from a provider's endpoint
 * - `providers:test-connection` — test connection to a provider
 */
export function registerProviderIpc(
  dataRoot: string,
  safeStorage: SafeStorageAdapter
): ProviderStore {
  const store = new ProviderStore(dataRoot, safeStorage)

  ipcMain.handle('providers:list', async () => {
    return store.list()
  })

  ipcMain.handle('providers:get', async (_event, input: unknown) => {
    const { id } = input as { id: string }
    return store.get(id)
  })

  ipcMain.handle('providers:get-active', async () => {
    return store.getActive()
  })

  ipcMain.handle('providers:create', async (_event, input: unknown) => {
    const { name, type, baseUrl, apiKey, models, selectedModel } = input as {
      name: string
      type: 'deepseek' | 'mimo' | 'custom'
      baseUrl: string
      apiKey: string
      models?: string[]
      selectedModel?: string
    }
    return store.create({ name, type, baseUrl, apiKey, models, selectedModel })
  })

  ipcMain.handle('providers:update', async (_event, input: unknown) => {
    const { id, ...updates } = input as {
      id: string
      name?: string
      type?: 'deepseek' | 'mimo' | 'custom'
      baseUrl?: string
      models?: string[]
      selectedModel?: string
      isActive?: boolean
    }
    return store.update(id, updates)
  })

  ipcMain.handle('providers:delete', async (_event, input: unknown) => {
    const { id } = input as { id: string }
    return store.delete(id)
  })

  ipcMain.handle('providers:set-active', async (_event, input: unknown) => {
    const { id } = input as { id: string }
    return store.update(id, { isActive: true })
  })

  ipcMain.handle('providers:set-api-key', async (_event, input: unknown) => {
    const { id, apiKey } = input as { id: string; apiKey: string }
    await store.setApiKey(id, apiKey)
  })

  ipcMain.handle('providers:has-api-key', async (_event, input: unknown) => {
    const { id } = input as { id: string }
    return store.hasApiKey(id)
  })

  ipcMain.handle('providers:fetch-models', async (_event, input: unknown) => {
    const { baseUrl, apiKey } = input as { baseUrl: string; apiKey: string }
    assertHttpsEndpoint(baseUrl)
    const modelsUrl = `${baseUrl.replace(/\/$/, '')}/models`

    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS)
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as { data?: Array<{ id: string }> }
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Invalid response format from models endpoint')
    }

    return data.data.map((m) => m.id).filter(Boolean)
  })

  ipcMain.handle('providers:test-connection', async (_event, input: unknown) => {
    const { baseUrl, apiKey } = input as { baseUrl: string; apiKey: string }
    try {
      assertHttpsEndpoint(baseUrl)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Invalid endpoint' }
    }
    const modelsUrl = `${baseUrl.replace(/\/$/, '')}/models`

    try {
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS)
      })

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        }
      }

      const data = await response.json() as { data?: Array<{ id: string }> }
      const models = data.data?.map((m) => m.id).filter(Boolean) ?? []

      return {
        success: true,
        models,
        message: `Found ${models.length} models`
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      }
    }
  })

  return store
}
