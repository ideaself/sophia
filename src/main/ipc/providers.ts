import { ipcMain } from 'electron'
import { ProviderStore } from '../storage/provider-store'
import type { SafeStorageAdapter } from '../security/secure-key-store'
import { assertHttpsEndpoint } from '../llm/endpoint'
import {
  IpcProviderCreateInputSchema,
  IpcProviderEndpointInputSchema,
  IpcProviderIdInputSchema,
  IpcProviderSetApiKeyInputSchema,
  IpcProviderUpdateInputSchema
} from '../../shared/schemas/ipc'

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
    const { id } = IpcProviderIdInputSchema.parse(input)
    return store.get(id)
  })

  ipcMain.handle('providers:get-active', async () => {
    return store.getActive()
  })

  ipcMain.handle('providers:create', async (_event, input: unknown) => {
    const parsed = IpcProviderCreateInputSchema.parse(input)
    // Defense-in-depth: the schema already enforces HTTPS, re-check at the
    // store boundary so a future schema edit cannot silently downgrade.
    assertHttpsEndpoint(parsed.baseUrl)
    return store.create(parsed)
  })

  ipcMain.handle('providers:update', async (_event, input: unknown) => {
    const { id, ...updates } = IpcProviderUpdateInputSchema.parse(input)
    /* v8 ignore next -- @preserve */
    if (updates.baseUrl !== undefined) assertHttpsEndpoint(updates.baseUrl)
    return store.update(id, updates)
  })

  ipcMain.handle('providers:delete', async (_event, input: unknown) => {
    const { id } = IpcProviderIdInputSchema.parse(input)
    return store.delete(id)
  })

  ipcMain.handle('providers:set-active', async (_event, input: unknown) => {
    const { id } = IpcProviderIdInputSchema.parse(input)
    return store.update(id, { isActive: true })
  })

  ipcMain.handle('providers:set-api-key', async (_event, input: unknown) => {
    const { id, apiKey } = IpcProviderSetApiKeyInputSchema.parse(input)
    await store.setApiKey(id, apiKey)
  })

  ipcMain.handle('providers:has-api-key', async (_event, input: unknown) => {
    const { id } = IpcProviderIdInputSchema.parse(input)
    return store.hasApiKey(id)
  })

  ipcMain.handle('providers:fetch-models', async (_event, input: unknown) => {
    const { baseUrl, apiKey } = IpcProviderEndpointInputSchema.parse(input)
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
    const parsed = IpcProviderEndpointInputSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        /* v8 ignore next -- @preserve -- zod 校验失败必带至少一条 issue，?. 与 ?? 均为纯防御 */
        error: parsed.error.issues[0]?.message ?? 'Invalid connection parameters'
      }
    }
    const { baseUrl, apiKey } = parsed.data
    try {
      assertHttpsEndpoint(baseUrl)
    } catch (err) {
      /* v8 ignore next -- @preserve */
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
