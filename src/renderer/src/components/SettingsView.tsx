import { useState, useEffect, useCallback } from 'react'
import { ThemeSwitcher } from './ThemeSwitcher'
import { WebDavSyncView } from './WebDavSyncView'

export function SettingsView(): React.ReactElement {
  const [providers, setProviders] = useState<ProviderDTO[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderDTO | null>(null)
  const [form, setForm] = useState({
    name: '',
    type: 'custom' as string,
    baseUrl: '',
    apiKey: '',
    models: [] as string[],
    selectedModel: ''
  })
  const [fetchingModels, setFetchingModels] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const loadProviders = useCallback(async () => {
    const list = await window.sophia.providers.list()
    setProviders(list)
    const active = await window.sophia.providers.getActive()
    setActiveId(active?.id ?? null)
  }, [])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  const openAddModal = () => {
    setEditingProvider(null)
    setForm({ name: '', type: 'custom', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', models: [], selectedModel: '' })
    setTestResult(null)
    setModalOpen(true)
  }

  const openEditModal = async (p: ProviderDTO) => {
    setEditingProvider(p)
    setForm({
      name: p.name,
      type: p.type,
      baseUrl: p.baseUrl,
      apiKey: '',
      models: p.models,
      selectedModel: p.selectedModel
    })
    setTestResult(null)
    setModalOpen(true)
  }

  const handleFetchModels = async () => {
    setFetchingModels(true)
    setTestResult(null)
    try {
      const key = form.apiKey || '__skip__'
      const result = await window.sophia.providers.testConnection(form.baseUrl, key)
      if (result.success && result.models && result.models.length > 0) {
        setForm((f) => ({ ...f, models: result.models!, selectedModel: result.models![0] }))
        setTestResult({ ok: true, msg: `Found ${result.models.length} models` })
      } else {
        setTestResult({ ok: false, msg: result.error || result.message || 'No models found' })
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setFetchingModels(false)
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const key = form.apiKey || '__skip__'
      const result = await window.sophia.providers.testConnection(form.baseUrl, key)
      if (result.success) {
        setTestResult({ ok: true, msg: result.message || 'Connection successful' })
        if (result.models && result.models.length > 0) {
          setForm((f) => ({ ...f, models: result.models!, selectedModel: result.models![0] }))
        }
      } else {
        setTestResult({ ok: false, msg: result.error || 'Connection failed' })
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.baseUrl.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (editingProvider) {
        await window.sophia.providers.update(editingProvider.id, {
          name: form.name.trim(),
          type: form.type,
          baseUrl: form.baseUrl.trim(),
          models: form.models,
          selectedModel: form.selectedModel
        })
        if (form.apiKey) {
          await window.sophia.providers.setApiKey(editingProvider.id, form.apiKey)
        }
      } else {
        await window.sophia.providers.create({
          name: form.name.trim(),
          type: form.type,
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey,
          models: form.models,
          selectedModel: form.selectedModel
        })
      }
      setModalOpen(false)
      await loadProviders()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleSetActive = async (id: string) => {
    await window.sophia.providers.setActive(id)
    await loadProviders()
  }

  const handleDelete = async (id: string) => {
    await window.sophia.providers.delete(id)
    setDeleteConfirmId(null)
    await loadProviders()
  }

  const PRESET_URLS: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    mimo: 'https://api.mimo.com/v1',
    custom: ''
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h2 className="mb-6 text-2xl font-bold">Settings</h2>

      <ThemeSwitcher />

      <WebDavSyncView />

      <div className="mb-8" />

      <h2 className="mb-6 text-2xl font-bold">API Provider Settings</h2>

      {error && (
        <div className="mb-4 rounded border border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-3 mb-6">
        {providers.map((p) => (
          <div
            key={p.id}
            className={`rounded-lg border p-4 transition-colors ${
              p.isActive
                ? 'border-accent-border bg-accent-subtle'
                : 'border-surface-border bg-bg-surface'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium">{p.name}</h4>
                  {p.isActive && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-white">
                      ACTIVE
                    </span>
                  )}
                  <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-text-muted">
                    {p.type}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-muted truncate">{p.baseUrl}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Model: {p.selectedModel || <span className="text-text-muted">none selected</span>}
                  {p.models.length > 0 && (
                    <span className="text-text-muted"> ({p.models.length} available)</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                {!p.isActive && (
                  <button
                    onClick={() => handleSetActive(p.id)}
                    className="rounded border border-accent px-3 py-1 text-xs text-accent-hover hover:bg-accent-subtle"
                  >
                    Set Active
                  </button>
                )}
                <button
                  onClick={() => openEditModal(p)}
                  className="rounded border border-surface-border-strong px-3 py-1 text-xs text-text-secondary hover:bg-bg-elevated"
                >
                  Edit
                </button>
                {deleteConfirmId === p.id ? (
                  <>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-500"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="rounded border border-surface-border-strong px-3 py-1 text-xs text-text-muted hover:bg-bg-elevated"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(p.id)}
                    className="rounded border border-surface-border-strong px-3 py-1 text-xs text-red-400 hover:bg-red-900/30"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {providers.length === 0 && (
          <div className="rounded-lg border border-dashed border-surface-border p-8 text-center">
            <p className="text-text-muted mb-3">No API providers configured</p>
            <p className="text-xs text-text-muted">Add a provider to start using the AI classroom</p>
          </div>
        )}
      </div>

      <button
        onClick={openAddModal}
        className="rounded-lg border border-dashed border-surface-border-strong w-full px-4 py-3 text-sm text-text-muted hover:border-accent-border hover:text-accent-hover transition-colors"
      >
        + Add Provider
      </button>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex w-[520px] flex-col rounded-lg border border-surface-border-strong bg-bg-deep shadow-xl max-h-[85vh]">
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
              <h3 className="text-lg font-semibold">
                {editingProvider ? 'Edit Provider' : 'Add Provider'}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
              >
                x
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="My Provider"
                  className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">Type</label>
                <div className="flex gap-2">
                  {(['deepseek', 'mimo', 'custom'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          type: t,
                          baseUrl: PRESET_URLS[t] || f.baseUrl
                        }))
                      }
                      className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                        form.type === t
                          ? 'bg-accent text-white'
                          : 'border border-surface-border-strong text-text-muted hover:bg-bg-elevated'
                      }`}
                    >
                      {t === 'deepseek' ? 'DeepSeek' : t === 'mimo' ? 'MiMo' : 'Custom'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">Base URL</label>
                <input
                  type="text"
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  placeholder="https://api.deepseek.com/v1"
                  className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">
                  API Key {editingProvider && '(leave blank to keep current)'}
                </label>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder="sk-..."
                  className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-gray-600 focus:border-accent-border focus:outline-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleTestConnection}
                  disabled={testing || !form.baseUrl}
                  className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated disabled:opacity-50"
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  onClick={handleFetchModels}
                  disabled={fetchingModels || !form.baseUrl}
                  className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated disabled:opacity-50"
                >
                  {fetchingModels ? 'Fetching...' : 'Fetch Models'}
                </button>
              </div>
              {testResult && (
                <p className={`text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {testResult.ok ? 'OK: ' : 'Error: '}{testResult.msg}
                </p>
              )}

              {form.models.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-muted">
                    Model ({form.models.length} available)
                  </label>
                  <select
                    value={form.selectedModel}
                    onChange={(e) => setForm((f) => ({ ...f, selectedModel: e.target.value }))}
                    className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
                  >
                    {form.models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}
              {form.models.length === 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-muted">
                    Model (manual entry)
                  </label>
                  <input
                    type="text"
                    value={form.selectedModel}
                    onChange={(e) => setForm((f) => ({ ...f, selectedModel: e.target.value }))}
                    placeholder="e.g. deepseek-v4-pro"
                    className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-gray-600 focus:border-accent-border focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-surface-border px-6 py-4">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded border border-surface-border-strong px-4 py-2 text-sm hover:bg-bg-elevated"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.baseUrl.trim()}
                className="rounded bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingProvider ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-text-muted">
        API keys are stored locally with system encryption. They are never uploaded or shared.
      </p>
    </div>
  )
}
