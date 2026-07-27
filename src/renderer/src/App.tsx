import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ClassroomView } from './chat/ClassroomView'
import { useChatStream } from './chat/useChatStream'

type AppView = 'settings' | 'companions' | 'textbooks' | 'classroom' | 'history'

interface Companion {
  id: string
  name: string
  identity: string
  personalityKeywords: string[]
}

interface Textbook {
  id: string
  title: string
  format: string
}

interface ActiveConversation {
  id: string
  companionId: string
  companionName: string
  textbookId: string | null
  textbookTitle: string | null
  title: string
  updatedAt: string
}

const WORLD_ID = 'world_default'

function App(): React.ReactElement {
  const [view, setView] = useState<AppView>('settings')

  const [companions, setCompanions] = useState<Companion[]>([])
  const [textbooks, setTextbooks] = useState<Textbook[]>([])
  const [selectedCompanion, setSelectedCompanion] = useState<Companion | null>(null)
  const [selectedTextbook, setSelectedTextbook] = useState<Textbook | null>(null)

  // Classroom picker state
  const [showClassroomDropdown, setShowClassroomDropdown] = useState(false)
  const [activeConversations, setActiveConversations] = useState<ActiveConversation[]>([])
  const [loadConversationId, setLoadConversationId] = useState<string | null>(null)

  const chatStream = useChatStream()
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('sophia-theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved)
  }, [])

  useEffect(() => {
    window.sophia.companions.list().then(setCompanions)
    window.sophia.data.listTextbooks(WORLD_ID).then(setTextbooks)
  }, [])

  // Fetch active conversations for the sidebar dropdown
  const fetchActiveConversations = useCallback(async () => {
    const convs = await window.sophia.data.listConversations(WORLD_ID)
    const active = convs.filter((c) => !c.endedAt)

    const enriched: ActiveConversation[] = []
    for (const c of active) {
      const comp = await window.sophia.companions.get(c.companionId)
      let tbTitle: string | null = null
      if (c.textbookId) {
        const tb = await window.sophia.data.getTextbook(c.textbookId)
        tbTitle = tb?.title ?? null
      }
      enriched.push({
        id: c.id,
        companionId: c.companionId,
        companionName: comp?.name ?? '未知角色',
        textbookId: c.textbookId,
        textbookTitle: tbTitle,
        title: c.title,
        updatedAt: c.updatedAt
      })
    }
    setActiveConversations(enriched)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    if (!showClassroomDropdown) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowClassroomDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showClassroomDropdown])

  // Load an active conversation into the classroom
  const handleResumeConversation = async (conv: ActiveConversation) => {
    // Load companion
    const comp = await window.sophia.companions.get(conv.companionId)
    if (comp) {
      setSelectedCompanion({
        id: comp.id,
        name: comp.name,
        identity: comp.identity,
        personalityKeywords: comp.personalityKeywords
      })
    }

    // Load textbook if present
    if (conv.textbookId) {
      const tb = await window.sophia.data.getTextbook(conv.textbookId)
      if (tb) {
        setSelectedTextbook({ id: tb.id, title: tb.title, format: tb.format })
      }
    } else {
      setSelectedTextbook(null)
    }

    setLoadConversationId(conv.id)
    setView('classroom')
    setShowClassroomDropdown(false)
  }

  // Start a new classroom (from dropdown or companion selection)
  const handleNewClassroom = (comp?: Companion) => {
    if (comp) {
      setSelectedCompanion(comp)
    }
    setLoadConversationId(null)
    setView('classroom')
    setShowClassroomDropdown(false)
  }

  // Handle sidebar "课堂" click
  const handleClassroomClick = async () => {
    if (view === 'classroom' && selectedCompanion) {
      // Already in classroom — toggle dropdown
      if (showClassroomDropdown) {
        setShowClassroomDropdown(false)
      } else {
        await fetchActiveConversations()
        setShowClassroomDropdown(true)
      }
    } else if (selectedCompanion) {
      // Not in classroom but have a companion — go to classroom
      setView('classroom')
    } else {
      // No companion selected — show dropdown with options
      await fetchActiveConversations()
      setShowClassroomDropdown(true)
    }
  }

  return (
    <div className="flex h-screen bg-bg-deep text-text-primary">
      {/* Sidebar */}
      <nav className="relative flex w-56 flex-col border-r border-surface-border bg-bg-surface">
        <div className="border-b border-surface-border p-4">
          <h1 className="text-lg font-bold">Sophia</h1>
          <p className="text-xs text-text-muted">AI 苏格拉底式学习伴侣</p>
        </div>
        <ul className="flex-1 space-y-1 p-2">
          <NavItem
            label="设置"
            active={view === 'settings'}
            onClick={() => setView('settings')}
          />
          <NavItem
            label="角色"
            active={view === 'companions'}
            onClick={() => setView('companions')}
          />
          <NavItem
            label="教材"
            active={view === 'textbooks'}
            onClick={() => setView('textbooks')}
          />
          <NavItem
            label="课堂"
            active={view === 'classroom'}
            onClick={handleClassroomClick}
          />
          <NavItem
            label="历史"
            active={view === 'history'}
            onClick={() => setView('history')}
          />
        </ul>

        {/* Classroom dropdown */}
        {showClassroomDropdown && (
          <div
            ref={dropdownRef}
            className="absolute left-full top-0 z-50 ml-1 w-72 rounded-lg border border-surface-border-strong bg-bg-surface shadow-xl"
          >
            <div className="border-b border-surface-border p-3">
              <h3 className="text-sm font-semibold">选择课堂</h3>
            </div>
            <div className="max-h-80 overflow-auto p-2">
              <button
                onClick={() => handleNewClassroom()}
                className="mb-1 w-full rounded-md border border-dashed border-surface-border-strong px-3 py-2 text-left text-sm text-text-secondary hover:border-accent-border hover:text-accent-hover"
              >
                + 新建课堂
              </button>
              {activeConversations.length === 0 && (
                <p className="px-3 py-2 text-xs text-text-muted">没有进行中的课堂</p>
              )}
              {activeConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleResumeConversation(conv)}
                  className="w-full rounded-md px-3 py-2 text-left hover:bg-bg-elevated"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{conv.companionName}</span>
                    {conv.textbookTitle && (
                      <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-text-muted">
                        📖 {conv.textbookTitle}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted truncate">{conv.title}</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">
                    {new Date(conv.updatedAt).toLocaleString()}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {view === 'settings' && <SettingsView />}
        {view === 'companions' && (
          <CompanionsView
            companions={companions}
            selected={selectedCompanion}
            onSelect={(c) => handleNewClassroom(c)}
          />
        )}
        {view === 'textbooks' && (
          <TextbooksView
            textbooks={textbooks}
            onRefresh={() =>
              window.sophia.data.listTextbooks(WORLD_ID).then(setTextbooks)
            }
            onSelect={(t) => setSelectedTextbook(t)}
          />
        )}
        {view === 'history' && (
          <HistoryView onResume={(convId) => {
            // Load conversation by ID — need to fetch companion/textbook
            window.sophia.data.getConversation(convId).then(async (conv) => {
              if (!conv) return
              const comp = await window.sophia.companions.get(conv.companionId)
              if (comp) {
                setSelectedCompanion({
                  id: comp.id,
                  name: comp.name,
                  identity: comp.identity,
                  personalityKeywords: comp.personalityKeywords
                })
              }
              if (conv.textbookId) {
                const tb = await window.sophia.data.getTextbook(conv.textbookId)
                if (tb) setSelectedTextbook({ id: tb.id, title: tb.title, format: tb.format })
              } else {
                setSelectedTextbook(null)
              }
              setLoadConversationId(convId)
              setView('classroom')
            })
          }} />
        )}
        {/* Always-mounted ClassroomView — hidden via CSS when not active */}
        <div className={view === 'classroom' ? 'h-full' : 'hidden h-full'}>
          <ClassroomView
            companion={selectedCompanion}
            textbook={selectedTextbook}
            chatStream={chatStream}
            loadConversationId={loadConversationId}
            onConversationLoaded={() => setLoadConversationId(null)}
          />
        </div>
      </main>
    </div>
  )
}

function NavItem({
  label,
  active,
  onClick,
  disabled
}: {
  label: string
  active: boolean
  onClick: () => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <li>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`w-full rounded px-3 py-2 text-left text-sm transition-colors ${
          active
            ? 'bg-accent text-white'
            : disabled
              ? 'cursor-not-allowed text-text-muted'
              : 'text-text-secondary hover:bg-bg-elevated'
        }`}
      >
        {label}
      </button>
    </li>
  )
}

// ─── Settings View ───────────────────────────────────────────────



interface ThemeOption {
  id: string
  name: string
  preview: { bg: string; surface: string; accent: string; text: string }
}

const THEMES: ThemeOption[] = [
  { id: 'dark', name: '暗夜', preview: { bg: '#111827', surface: '#1f2937', accent: '#2563eb', text: '#f3f4f6' } },
  { id: 'midnight', name: '午夜蓝', preview: { bg: '#0f172a', surface: '#1e293b', accent: '#6366f1', text: '#e2e8f0' } },
  { id: 'emerald', name: '翡翠', preview: { bg: '#0c1a12', surface: '#132a1c', accent: '#10b981', text: '#d1fae5' } },
  { id: 'light', name: '暖光', preview: { bg: '#fafaf9', surface: '#ffffff', accent: '#b45309', text: '#1c1917' } }
]

function ThemeSwitcher(): React.ReactElement {
  const [current, setCurrent] = useState(() => localStorage.getItem('sophia-theme') || 'dark')

  const handleSelect = (themeId: string) => {
    if (themeId === 'dark') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', themeId)
    }
    localStorage.setItem('sophia-theme', themeId)
    setCurrent(themeId)
  }

  return (
    <div className="rounded-lg border border-surface-border bg-bg-surface p-6">
      <h3 className="mb-4 text-lg font-semibold text-text-primary">Theme</h3>
      <div className="grid grid-cols-4 gap-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => handleSelect(t.id)}
            className={`rounded-lg border-2 p-3 transition-all ${
              current === t.id
                ? 'border-accent-border shadow-lg'
                : 'border-surface-border hover:border-surface-border-strong'
            }`}
          >
            <div className="mb-2 flex gap-1">
              <div className="h-4 w-4 rounded-full" style={{ backgroundColor: t.preview.bg }} />
              <div className="h-4 w-4 rounded-full" style={{ backgroundColor: t.preview.surface }} />
              <div className="h-4 w-4 rounded-full" style={{ backgroundColor: t.preview.accent }} />
              <div className="h-4 w-4 rounded-full border border-surface-border-strong" style={{ backgroundColor: t.preview.text }} />
            </div>
            <p className={`text-xs font-medium ${current === t.id ? 'text-text-primary' : 'text-text-secondary'}`}>
              {t.name}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}


function SettingsView(): React.ReactElement {
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

// ─── Companions View ─────────────────────────────────────────────

function CompanionsView({
  companions,
  selected,
  onSelect
}: {
  companions: Companion[]
  selected: Companion | null
  onSelect: (c: Companion) => void
}): React.ReactElement {
  return (
    <div className="p-8">
      <h2 className="mb-6 text-2xl font-bold">选择角色</h2>
      <p className="mb-6 text-text-muted">选择一个苏格拉底式的学习伙伴开始上课。</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {companions.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className={`rounded-lg border p-5 text-left transition-all hover:border-accent-border hover:shadow-lg ${
              selected?.id === c.id
                ? 'border-accent-border bg-accent-subtle'
                : 'border-surface-border bg-bg-surface'
            }`}
          >
            <h3 className="text-lg font-semibold">{c.name}</h3>
            <p className="mt-1 text-sm text-text-muted">{c.identity}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {c.personalityKeywords.map((kw) => (
                <span
                  key={kw}
                  className="rounded-full bg-bg-elevated px-2 py-0.5 text-xs text-text-secondary"
                >
                  {kw}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      {companions.length === 0 && (
        <p className="text-text-muted">暂无可用角色。请检查 reference 目录。</p>
      )}
    </div>
  )
}

// ─── Textbooks View ──────────────────────────────────────────────

function TextbooksView({
  textbooks,
  onRefresh,
  onSelect
}: {
  textbooks: Textbook[]
  onRefresh: () => void
  onSelect: (t: Textbook) => void
}): React.ReactElement {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [viewingTextbook, setViewingTextbook] = useState<Textbook | null>(null)
  const [viewingContent, setViewingContent] = useState('')
  const [loadingContent, setLoadingContent] = useState(false)
  const [editingTextbook, setEditingTextbook] = useState<Textbook | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const handleTextImport = async () => {
    if (!title.trim()) return
    setImporting(true)
    setError('')
    try {
      await window.sophia.data.createTextbook({
        worldId: WORLD_ID,
        title: title.trim(),
        format: 'markdown',
        content
      })
      setTitle('')
      setContent('')
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const handleFileImport = async () => {
    setImporting(true)
    setError('')
    try {
      const result = await window.sophia.dialog.openFile()
      if (result.canceled || !result.filePaths[0]) {
        setImporting(false)
        return
      }

      const filePath = result.filePaths[0]
      const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
      const fileName = filePath.split(/[/\\]/).pop() ?? filePath
      const autoTitle = fileName.replace(/\.[^.]+$/, '')

      let format: 'pdf' | 'epub' | 'markdown' | 'text' = 'markdown'
      if (ext === 'pdf') format = 'pdf'
      else if (ext === 'epub') format = 'epub'
      else if (ext === 'txt') format = 'text'

      await window.sophia.data.createTextbook({
        worldId: WORLD_ID,
        title: title.trim() || autoTitle,
        format,
        sourceFile: filePath
      })
      setTitle('')
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const handleViewContent = async (t: Textbook) => {
    setViewingTextbook(t)
    setLoadingContent(true)
    try {
      const full = await window.sophia.data.getTextbook(t.id)
      setViewingContent(full?.content ?? '')
    } catch {
      setViewingContent('加载失败')
    } finally {
      setLoadingContent(false)
    }
  }

  const handleEdit = async (t: Textbook) => {
    setEditingTextbook(t)
    setEditTitle(t.title)
    try {
      const full = await window.sophia.data.getTextbook(t.id)
      setEditContent(full?.content ?? "")
    } catch {
      setEditContent("")
    }
  }

  const handleSaveEdit = async () => {
    if (!editingTextbook || !editTitle.trim()) return
    setSaving(true)
    try {
      await window.sophia.data.updateTextbook(editingTextbook.id, { title: editTitle.trim(), content: editContent })
      setEditingTextbook(null)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async (t: Textbook) => {
    await window.sophia.data.deleteTextbook(t.id)
    setDeleteConfirmId(null)
    onRefresh()
  }

  return (
    <div className="p-8">
      <h2 className="mb-6 text-2xl font-bold">教材</h2>

      {/* Import form */}
      <div className="mb-8 rounded-lg border border-surface-border bg-bg-surface p-6">
        <h3 className="mb-4 text-lg font-semibold">导入教材</h3>
        <div className="space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="教材标题（从文件导入时可留空）"
            className="w-full rounded border border-surface-border-strong bg-bg-deep px-4 py-2 text-sm text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="粘贴 Markdown 或文本内容..."
            rows={6}
            className="w-full rounded border border-surface-border-strong bg-bg-deep px-4 py-2 text-sm text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
          />
          <div className="flex gap-3">
            <button
              onClick={handleTextImport}
              disabled={importing || !title.trim() || !content.trim()}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {importing ? '导入中...' : '粘贴导入'}
            </button>
            <button
              onClick={handleFileImport}
              disabled={importing}
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              {importing ? '解析中...' : '从文件导入 (PDF/EPUB)'}
            </button>
          </div>
          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </div>
      </div>

      {/* Textbook list */}
      <div className="space-y-3">
        {textbooks.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between rounded-lg border border-surface-border bg-bg-surface p-4"
          >
            <div>
              <h4 className="font-medium">{t.title}</h4>
              <p className="text-xs text-text-muted">{t.format}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleViewContent(t)}
                className="rounded border border-surface-border-strong px-3 py-1 text-sm hover:bg-bg-elevated"
              >
                查看
              </button>
              <button
                onClick={() => handleEdit(t)}
                className="rounded border border-surface-border-strong px-3 py-1 text-sm hover:bg-bg-elevated"
              >
                编辑
              </button>
              {deleteConfirmId === t.id ? (
                <>
                  <button
                    onClick={() => confirmDelete(t)}
                    className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500"
                  >
                    确认删除
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="rounded border border-surface-border-strong px-3 py-1 text-sm hover:bg-bg-elevated"
                  >
                    取消
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setDeleteConfirmId(t.id)}
                  className="rounded border border-surface-border-strong px-3 py-1 text-sm text-red-400 hover:bg-red-900/30"
                >
                  删除
                </button>
              )}
              <button
                onClick={() => onSelect(t)}
                className="rounded bg-accent px-3 py-1 text-sm text-white hover:bg-accent-hover"
              >
                选择
              </button>
            </div>
          </div>
        ))}
        {textbooks.length === 0 && (
          <p className="text-text-muted">暂无教材。请在上方导入。</p>
        )}
      </div>

      {/* Textbook edit modal */}
      {editingTextbook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex h-[80vh] w-[80vw] flex-col rounded-lg border border-surface-border-strong bg-bg-deep shadow-xl">
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
              <h3 className="text-lg font-semibold">编辑教材</h3>
              <button
                onClick={() => setEditingTextbook(null)}
                className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="教材标题"
                className="w-full rounded border border-surface-border-strong bg-bg-surface px-4 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
              />
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="教材内容 (Markdown)..."
                className="h-full w-full rounded border border-surface-border-strong bg-bg-surface px-4 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
                style={{ minHeight: '50vh' }}
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-surface-border px-6 py-4">
              <button
                onClick={() => setEditingTextbook(null)}
                className="rounded border border-surface-border-strong px-4 py-2 text-sm hover:bg-bg-elevated"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving || !editTitle.trim()}
                className="rounded bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Textbook content viewer modal */}
      {viewingTextbook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex h-[80vh] w-[80vw] flex-col rounded-lg border border-surface-border-strong bg-bg-deep shadow-xl">
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold">{viewingTextbook.title}</h3>
                <p className="text-xs text-text-muted">{viewingTextbook.format}</p>
              </div>
              <button
                onClick={() => setViewingTextbook(null)}
                className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4">
              {loadingContent ? (
                <p className="text-sm text-text-muted">加载中...</p>
              ) : (
                <div className="markdown-body text-sm leading-relaxed text-text-secondary">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {viewingContent}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── History View ────────────────────────────────────────────────

function HistoryView({ onResume }: { onResume: (conversationId: string) => void }): React.ReactElement {
  const [conversations, setConversations] = useState<ConversationDTO[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResultDTO[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedMessages, setExpandedMessages] = useState<MessageDTO[]>([])
  const [expandedArtifacts, setExpandedArtifacts] = useState<ArtifactDTO[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  useEffect(() => {
    window.sophia.data.listConversations(WORLD_ID).then(setConversations)
  }, [])

  const handleStartEdit = (conv: ConversationDTO) => {
    setEditingId(conv.id)
    setEditingTitle(conv.title)
  }

  const handleSaveTitle = async (convId: string) => {
    if (!editingTitle.trim()) {
      setEditingId(null)
      return
    }
    await window.sophia.data.updateTitle(convId, editingTitle.trim())
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, title: editingTitle.trim() } : c))
    )
    setEditingId(null)
  }

  const handleDeleteConversation = async (convId: string) => {
    if (!confirm('确定删除这个课程记录？')) return
    await window.sophia.data.deleteConversation(convId)
    setConversations((prev) => prev.filter((c) => c.id !== convId))
    if (expandedId === convId) {
      setExpandedId(null)
      setExpandedMessages([])
      setExpandedArtifacts([])
    }
  }

  const handleSearch = async () => {
    if (searchQuery.trim().length < 2) return
    const results = await window.sophia.data.searchMessages(WORLD_ID, searchQuery.trim())
    setSearchResults(results)
  }

  const handleToggleMessages = async (convId: string) => {
    if (expandedId === convId) {
      setExpandedId(null)
      setExpandedMessages([])
      setExpandedArtifacts([])
      return
    }
    setLoadingMessages(true)
    setExpandedId(convId)
    try {
      const [msgs, artifacts] = await Promise.all([
        window.sophia.data.listMessages(convId),
        window.sophia.data.listArtifacts(convId)
      ])
      setExpandedMessages(msgs)
      setExpandedArtifacts(artifacts)
    } catch {
      setExpandedMessages([])
      setExpandedArtifacts([])
    } finally {
      setLoadingMessages(false)
    }
  }

  // Resolve companion names
  const [companionMap, setCompanionMap] = useState<Record<string, string>>({})
  useEffect(() => {
    const ids = [...new Set(conversations.map((c) => c.companionId))]
    Promise.all(ids.map(async (id) => {
      const comp = await window.sophia.companions.get(id)
      return [id, comp?.name ?? '未知'] as const
    })).then((pairs) => {
      setCompanionMap(Object.fromEntries(pairs))
    })
  }, [conversations])

  return (
    <div className="p-8">
      <h2 className="mb-6 text-2xl font-bold">学习历史</h2>

      {/* Search */}
      <div className="mb-6 flex gap-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="搜索对话内容..."
          className="flex-1 rounded border border-surface-border-strong bg-bg-surface px-4 py-2 text-sm text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={searchQuery.trim().length < 2}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          搜索
        </button>
      </div>

      {/* Search results */}
      {searchResults !== null && (
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              搜索结果 ({searchResults.length})
            </h3>
            <button
              onClick={() => setSearchResults(null)}
              className="text-sm text-text-muted hover:text-text-secondary"
            >
              清除
            </button>
          </div>
          {searchResults.length === 0 ? (
            <p className="text-text-muted">无匹配结果</p>
          ) : (
            <div className="space-y-2">
              {searchResults.map((r, i) => (
                <div key={i} className="rounded-lg border border-surface-border bg-bg-surface p-3">
                  <p className="text-sm text-text-secondary">{r.message.content}</p>
                  <p className="mt-1 text-xs text-text-muted">
                    {new Date(r.message.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Conversation list */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">所有课程</h3>
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className="rounded-lg border border-surface-border bg-bg-surface"
          >
            <button
              onClick={() => handleToggleMessages(conv.id)}
              className="w-full p-4 text-left"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  {editingId === conv.id ? (
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveTitle(conv.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="flex-1 rounded border border-accent-border bg-bg-deep px-2 py-1 text-sm text-text-primary focus:outline-none"
                        autoFocus
                      />
                      <button onClick={() => handleSaveTitle(conv.id)} className="text-xs text-accent-hover hover:text-accent-hover">保存</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-text-muted hover:text-text-secondary">取消</button>
                    </div>
                  ) : (
                    <h4
                      className="font-medium cursor-pointer hover:text-accent-hover"
                      onClick={(e) => { e.stopPropagation(); handleStartEdit(conv) }}
                      title="点击编辑标题"
                    >
                      {conv.title}
                    </h4>
                  )}
                  <p className="text-xs text-text-muted">
                    {companionMap[conv.companionId] ?? conv.companionId} · {new Date(conv.createdAt).toLocaleString()}
                    {conv.endedAt && ' · 已下课'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {conv.endedAt ? (
                    <span className="rounded-full bg-amber-900/30 px-2 py-0.5 text-xs text-amber-400">
                      已下课
                    </span>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onResume(conv.id)
                      }}
                      className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover"
                    >
                      继续上课
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id) }}
                    className="text-xs text-text-muted hover:text-red-400"
                    title="删除课程"
                  >
                    🗑
                  </button>
                  <span className="text-text-muted text-xs">
                    {expandedId === conv.id ? '▾' : '▸'}
                  </span>
                </div>
              </div>
            </button>

            {/* Expanded message list + artifacts */}
            {expandedId === conv.id && (
              <div className="border-t border-surface-border px-4 py-3 space-y-3 max-h-96 overflow-auto">
                {loadingMessages ? (
                  <p className="text-xs text-text-muted">加载中...</p>
                ) : (
                  <>
                    {/* Artifacts */}
                    {expandedArtifacts.length > 0 && (
                      <div className="space-y-2">
                        <h5 className="text-xs font-medium text-text-muted uppercase">学习资料</h5>
                        {expandedArtifacts.map((art) => (
                          <div key={art.id} className="rounded bg-bg-elevated/50 px-3 py-2">
                            <p className="text-xs font-medium text-text-secondary mb-1">
                              {art.type === 'lesson_summary' ? '📋 课堂总结' :
                               art.type === 'flashcards' ? '🃏 记忆卡片' :
                               art.type === 'diary' ? '📝 学习日记' :
                               art.type === 'progress' ? '📈 学习进展' :
                               art.type === 'handoff_tail' ? '🔗 接力尾巴' : art.type}
                            </p>
                            <div className="markdown-body text-xs text-text-secondary max-h-32 overflow-auto">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {art.content}
                              </ReactMarkdown>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Messages */}
                    {expandedMessages.length === 0 ? (
                      <p className="text-xs text-text-muted">暂无消息记录</p>
                    ) : (
                      <div className="space-y-2">
                        <h5 className="text-xs font-medium text-text-muted uppercase">对话记录</h5>
                        {expandedMessages.map((msg) => (
                          <div key={msg.id} className={`rounded px-3 py-2 text-sm ${
                            msg.role === 'user'
                              ? 'bg-accent-subtle ml-8'
                              : msg.role === 'assistant'
                                ? 'bg-bg-elevated mr-8'
                                : 'bg-bg-surface text-text-muted'
                          }`}>
                            <p className="text-xs text-text-muted mb-1">
                              {msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : '系统'} · {new Date(msg.createdAt).toLocaleTimeString()}
                            </p>
                            <p className="text-text-secondary whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {conversations.length === 0 && (
          <p className="text-text-muted">暂无历史记录。</p>
        )}
      </div>
    </div>
  )
}

export default App