import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ClassroomView } from './chat/ClassroomView'
import { useChatStream } from './chat/useChatStream'
import { PdfReaderView } from './reader/PdfReaderView'

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
  originalFile: string
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
  const [view, setView] = useState<AppView>('classroom')

  const [companions, setCompanions] = useState<Companion[]>([])
  const [textbooks, setTextbooks] = useState<Textbook[]>([])
  const [selectedCompanion, setSelectedCompanion] = useState<Companion | null>(null)
  const [selectedTextbook, setSelectedTextbook] = useState<Textbook | null>(null)

  const [showClassroomDropdown, setShowClassroomDropdown] = useState(false)
  const [activeConversations, setActiveConversations] = useState<ActiveConversation[]>([])
  const [loadConversationId, setLoadConversationId] = useState<string | null>(null)
  const [classroomResetKey, setClassroomResetKey] = useState(0)

  const [editingCompanion, setEditingCompanion] = useState<CompanionDTO | null>(null)
  const [isCreatingCompanion, setIsCreatingCompanion] = useState(false)

  const chatStream = useChatStream()
  const classroomDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    (async () => {
      const convs = await window.sophia.data.listConversations(WORLD_ID)
      const active = convs.filter((c) => !c.endedAt).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      if (active.length > 0) {
        const last = active[0]
        const comp = await window.sophia.companions.get(last.companionId)
        if (comp) setSelectedCompanion({ id: comp.id, name: comp.name, identity: comp.identity, personalityKeywords: comp.personalityKeywords })
        if (last.textbookId) {
          const tb = await window.sophia.data.getTextbook(last.textbookId)
          if (tb) setSelectedTextbook({ id: tb.id, title: tb.title, format: tb.format, originalFile: tb.originalFile })
        }
        setLoadConversationId(last.id)
      }
    })()
  }, [])

  const reloadCompanions = useCallback(() => {
    window.sophia.companions.list().then(setCompanions)
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('sophia-theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved)
  }, [])

  useEffect(() => {
    reloadCompanions()
    window.sophia.data.listTextbooks(WORLD_ID).then(setTextbooks)
  }, [reloadCompanions])

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
        id: c.id, companionId: c.companionId, companionName: comp?.name ?? '未知角色',
        textbookId: c.textbookId, textbookTitle: tbTitle, title: c.title, updatedAt: c.updatedAt
      })
    }
    setActiveConversations(enriched)
  }, [])

  const handlePullComplete = useCallback(() => {
    window.sophia.data.listTextbooks(WORLD_ID).then(setTextbooks)
    fetchActiveConversations()
  }, [fetchActiveConversations])

  useEffect(() => {
    if (!showClassroomDropdown) return
    const handler = (e: MouseEvent) => {
      if (classroomDropdownRef.current && !classroomDropdownRef.current.contains(e.target as Node)) {
        setShowClassroomDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showClassroomDropdown])

  const handleResumeConversation = async (conv: ActiveConversation) => {
    const comp = await window.sophia.companions.get(conv.companionId)
    if (comp) {
      setSelectedCompanion({ id: comp.id, name: comp.name, identity: comp.identity, personalityKeywords: comp.personalityKeywords })
    }
    if (conv.textbookId) {
      const tb = await window.sophia.data.getTextbook(conv.textbookId)
      if (tb) setSelectedTextbook({ id: tb.id, title: tb.title, format: tb.format, originalFile: tb.originalFile })
    } else { setSelectedTextbook(null) }
    setLoadConversationId(conv.id)
    setView('classroom')
    setShowClassroomDropdown(false)
  }

  const handleNewClassroom = (comp?: Companion) => {
    if (comp) {
      setSelectedCompanion(comp)
      setLoadConversationId(null)
      setClassroomResetKey((k) => k + 1)
      setView('classroom')
    } else {
      setView('companions')
    }
    setShowClassroomDropdown(false)
  }

  const handleClassroomClick = async () => {
    if (view === 'classroom' && selectedCompanion) {
      if (showClassroomDropdown) { setShowClassroomDropdown(false) }
      else { await fetchActiveConversations(); setShowClassroomDropdown(true) }
    } else if (selectedCompanion) {
      setView('classroom')
    } else {
      await fetchActiveConversations()
      setShowClassroomDropdown(true)
    }
  }

  const handleEditCompanionFromDropdown = async (c: Companion) => {
    const full = await window.sophia.companions.get(c.id)
    if (full) setEditingCompanion(full)
  }

  const handleCreateCompanion = () => {
    setEditingCompanion(null)
    setIsCreatingCompanion(true)
  }

  const handleSaveCompanion = async (form: {
    name: string; gender: string; age: number; identity: string;
    personalityKeywords: string[]; personality: string; speakingStyle: string; emotionalExpressions: string
  }) => {
    if (isCreatingCompanion) {
      await window.sophia.companions.create(form)
    } else if (editingCompanion) {
      await window.sophia.companions.update(editingCompanion.id, form)
    }
    setEditingCompanion(null)
    setIsCreatingCompanion(false)
    reloadCompanions()
  }

  const handleDeleteCompanion = async () => {
    if (!editingCompanion) return
    await window.sophia.companions.delete(editingCompanion.id)
    setEditingCompanion(null)
    setIsCreatingCompanion(false)
    reloadCompanions()
  }

  return (
    <div className="flex h-screen flex-col bg-bg-deep text-text-primary">
      {/* Top menu bar */}
      <header className="flex items-center border-b border-surface-border bg-bg-surface px-4">
        <nav className="flex items-center gap-1">
          <div className="relative" ref={classroomDropdownRef}>
            <button onClick={handleClassroomClick}
              className={`rounded px-3 py-2 text-sm transition-colors ${view === 'classroom' || showClassroomDropdown ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-elevated'}`}>
              课堂
            </button>
            {showClassroomDropdown && (
              <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-surface-border-strong bg-bg-surface shadow-xl">
                <div className="border-b border-surface-border p-3">
                  <h3 className="text-sm font-semibold">选择课堂</h3>
                </div>
                <div className="max-h-80 overflow-auto p-2">
                  <button onClick={() => handleNewClassroom()}
                    className="mb-1 w-full rounded-md border border-dashed border-surface-border-strong px-3 py-2 text-left text-sm text-text-secondary hover:border-accent-border hover:text-accent-hover">
                    + 新建课堂
                  </button>
                  {activeConversations.length === 0 && (
                    <p className="px-3 py-2 text-xs text-text-muted">没有进行中的课堂</p>
                  )}
                  {activeConversations.map((conv) => (
                    <button key={conv.id} onClick={() => handleResumeConversation(conv)}
                      className="w-full rounded-md px-3 py-2 text-left hover:bg-bg-elevated">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{conv.companionName}</span>
                        {conv.textbookTitle && (
                          <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-text-muted">{conv.textbookTitle}</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-text-muted truncate">{conv.title}</p>
                      <p className="mt-0.5 text-[10px] text-text-muted">{new Date(conv.updatedAt).toLocaleString()}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button onClick={() => { setView('history'); setShowClassroomDropdown(false) }}
            className={`rounded px-3 py-2 text-sm transition-colors ${view === 'history' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-elevated'}`}>
            历史
          </button>

          <button onClick={() => { setView('textbooks'); setShowClassroomDropdown(false) }}
            className={`rounded px-3 py-2 text-sm transition-colors ${view === 'textbooks' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-elevated'}`}>
            教材
          </button>

          <button onClick={() => { setView('companions'); setShowClassroomDropdown(false) }}
            className={`rounded px-3 py-2 text-sm transition-colors ${view === 'companions' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-elevated'}`}>
            角色
          </button>

          <button onClick={() => { setView('settings'); setShowClassroomDropdown(false) }}
            className={`rounded px-3 py-2 text-sm transition-colors ${view === 'settings' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-elevated'}`}>
            设置
          </button>
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {view === 'settings' && <SettingsView onPullComplete={handlePullComplete} />}
        {view === 'companions' && (
          <CompanionsManageView
            companions={companions}
            onEdit={(c) => handleEditCompanionFromDropdown(c)}
            onAdd={() => handleCreateCompanion()}
            onRefresh={reloadCompanions}
            onStart={(c) => {
              setSelectedCompanion(c)
              setLoadConversationId(null)
              setClassroomResetKey((k) => k + 1)
              setView('classroom')
            }}
          />
        )}
        {view === 'textbooks' && (
          <TextbooksView textbooks={textbooks}
            onRefresh={() => window.sophia.data.listTextbooks(WORLD_ID).then(setTextbooks)}
            onSelect={(t) => setSelectedTextbook(t)} />
        )}
        {view === 'history' && (
          <HistoryView onResume={(convId) => {
            window.sophia.data.getConversation(convId).then(async (conv) => {
              if (!conv) return
              const comp = await window.sophia.companions.get(conv.companionId)
              if (comp) setSelectedCompanion({ id: comp.id, name: comp.name, identity: comp.identity, personalityKeywords: comp.personalityKeywords })
              if (conv.textbookId) {
                const tb = await window.sophia.data.getTextbook(conv.textbookId)
                if (tb) setSelectedTextbook({ id: tb.id, title: tb.title, format: tb.format, originalFile: tb.originalFile })
              } else { setSelectedTextbook(null) }
              setLoadConversationId(convId)
              setView('classroom')
            })
          }} />
        )}
        <div key={classroomResetKey} className={view === 'classroom' ? 'h-full' : 'hidden h-full'}>
          <ClassroomView companion={selectedCompanion} textbook={selectedTextbook} chatStream={chatStream}
            loadConversationId={loadConversationId} onConversationLoaded={() => setLoadConversationId(null)} />
        </div>
      </main>

      {/* Companion edit/create modal */}
      {(editingCompanion || isCreatingCompanion) && (
        <CompanionEditModal companion={editingCompanion} isCreating={isCreatingCompanion}
          onSave={handleSaveCompanion} onDelete={!isCreatingCompanion ? handleDeleteCompanion : undefined}
          onClose={() => { setEditingCompanion(null); setIsCreatingCompanion(false) }} />
      )}
    </div>
  )
}
// ─── Settings View ───────────────────────────────────────────────



function CompanionEditModal({
  companion,
  isCreating,
  onSave,
  onDelete,
  onClose
}: {
  companion: CompanionDTO | null
  isCreating: boolean
  onSave: (form: {
    name: string
    gender: string
    age: number
    identity: string
    personalityKeywords: string[]
    personality: string
    speakingStyle: string
    emotionalExpressions: string
  }) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}): React.ReactElement {
  const [form, setForm] = useState({
    name: companion?.name ?? '',
    gender: companion?.gender ?? 'female',
    age: companion?.age ?? 20,
    identity: companion?.identity ?? '',
    personalityKeywords: companion?.personalityKeywords.join(', ') ?? '',
    personality: companion?.personality ?? '',
    speakingStyle: companion?.speakingStyle ?? '',
    emotionalExpressions: companion?.emotionalExpressions ?? ''
  })
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({
        name: form.name.trim(),
        gender: form.gender,
        age: form.age,
        identity: form.identity.trim(),
        personalityKeywords: form.personalityKeywords.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        personality: form.personality.trim(),
        speakingStyle: form.speakingStyle.trim(),
        emotionalExpressions: form.emotionalExpressions.trim()
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex w-[520px] flex-col rounded-lg border border-surface-border-strong bg-bg-deep shadow-xl max-h-[85vh]">
        <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
          <h3 className="text-lg font-semibold">
            {isCreating ? '添加自定义角色' : `编辑: ${companion?.name}`}
          </h3>
          <button onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-secondary">x</button>
        </div>
        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">名字</label>
            <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="角色名称"
              className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">性别</label>
              <select value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none">
                <option value="male">男</option>
                <option value="female">女</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">年龄</label>
              <input type="number" value={form.age} onChange={(e) => setForm((f) => ({ ...f, age: parseInt(e.target.value) || 0 }))}
                className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">身份</label>
            <input type="text" value={form.identity} onChange={(e) => setForm((f) => ({ ...f, identity: e.target.value }))}
              placeholder="如：苏格拉底式哲学导师"
              className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">性格关键词 (逗号分隔)</label>
            <input type="text" value={form.personalityKeywords} onChange={(e) => setForm((f) => ({ ...f, personalityKeywords: e.target.value }))}
              placeholder="如：温和, 耐心, 幽默"
              className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">性格描述</label>
            <textarea value={form.personality} onChange={(e) => setForm((f) => ({ ...f, personality: e.target.value }))}
              rows={3} placeholder="描述角色的性格特征..."
              className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">说话风格</label>
            <textarea value={form.speakingStyle} onChange={(e) => setForm((f) => ({ ...f, speakingStyle: e.target.value }))}
              rows={2} placeholder="描述角色的说话方式..."
              className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">情感表达</label>
            <textarea value={form.emotionalExpressions} onChange={(e) => setForm((f) => ({ ...f, emotionalExpressions: e.target.value }))}
              rows={2} placeholder="描述角色的情感表达方式..."
              className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
          </div>
        </div>
        <div className="flex justify-between border-t border-surface-border px-6 py-4">
          <div>
            {!isCreating && onDelete && (
              deleteConfirm ? (
                <div className="flex gap-2">
                  <button onClick={onDelete}
                    className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-500">确认删除</button>
                  <button onClick={() => setDeleteConfirm(false)}
                    className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-muted hover:bg-bg-elevated">取消</button>
                </div>
              ) : (
                <button onClick={() => setDeleteConfirm(true)}
                  className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30">删除角色</button>
              )
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="rounded border border-surface-border-strong px-4 py-2 text-sm hover:bg-bg-elevated">取消</button>
            <button onClick={handleSave} disabled={saving || !form.name.trim() || !form.identity.trim()}
              className="rounded bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50">
              {saving ? '保存中...' : isCreating ? '创建' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface ThemeOption {
  id: string
  name: string
  preview: { bg: string; surface: string; accent: string; text: string }
}

const THEMES: ThemeOption[] = [
  { id: 'dark', name: '暗夜', preview: { bg: '#111827', surface: '#1f2937', accent: '#2563eb', text: '#f3f4f6' } },
  { id: 'midnight', name: '午夜蓝', preview: { bg: '#0a0e1a', surface: '#111832', accent: '#3b82f6', text: '#f0f4ff' } },
  { id: 'emerald', name: '森林', preview: { bg: '#11130f', surface: '#1a1e16', accent: '#84cc16', text: '#e8ebe4' } },
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



function WebDavSyncView({ onPullComplete }: { onPullComplete?: () => void }): React.ReactElement {
  const [url, setUrl] = useState(() => localStorage.getItem('webdav-url') || '')
  const [username, setUsername] = useState(() => localStorage.getItem('webdav-username') || '')
  // Password is never persisted in the renderer; it lives encrypted in the main process.
  const [password, setPassword] = useState('')
  const [hasPassword, setHasPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [lastPush, setLastPush] = useState(() => localStorage.getItem('webdav-last-push') || '')
  const [lastPull, setLastPull] = useState(() => localStorage.getItem('webdav-last-pull') || '')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)

  useEffect(() => {
    // One-time migration: purge any plaintext password saved by older versions
    localStorage.removeItem('webdav-password')
    window.sophia.sync.hasWebdavPassword().then(setHasPassword)
    return window.sophia.sync.onProgress(setProgress)
  }, [])

  const getConfig = () => ({ url: url.trim(), username: username.trim() })

  const saveToStorage = async () => {
    localStorage.setItem('webdav-url', url.trim())
    localStorage.setItem('webdav-username', username.trim())
    if (password.length > 0) {
      await window.sophia.sync.setWebdavPassword(password)
      setHasPassword(true)
      setPassword('')
    }
  }

  const handleTest = async () => {
    await saveToStorage()
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.sophia.sync.test(getConfig())
      setTestResult({ ok: res.success, msg: res.message || 'Unknown result' })
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setTesting(false)
    }
  }

  const handlePush = async () => {
    await saveToStorage()
    try {
      const plan = await window.sophia.sync.planPush(getConfig())
      if (plan.deleteCount > 0) {
        const sample = plan.deleteSample.slice(0, 10).join('\n')
        const more = plan.deleteCount > 10 ? `\n... and ${plan.deleteCount - 10} more` : ''
        if (!confirm(`Push will DELETE ${plan.deleteCount} remote file(s) that no longer exist locally:\n${sample}${more}\n\nContinue?`)) {
          return
        }
      }
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Push planning failed' })
      return
    }
    setPushing(true)
    setResult(null)
    setProgress(null)
    try {
      const res = await window.sophia.sync.push(getConfig())
      if (res.success) {
        setResult({ ok: true, msg: `Pushed ${res.transferred}, skipped ${res.skipped}, deleted ${res.deleted}` })
        if (res.timestamp) {
          setLastPush(res.timestamp)
          localStorage.setItem('webdav-last-push', res.timestamp)
        }
      } else {
        setResult({ ok: false, msg: `Pushed ${res.transferred}, skipped ${res.skipped}, deleted ${res.deleted}, ${res.errors.length} errors: ${res.errors[0]}` })
      }
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Push failed' })
    } finally {
      setPushing(false)
      setProgress(null)
    }
  }

  const handlePull = async () => {
    await saveToStorage()
    if (lastPush) {
      const ago = Date.now() - new Date(lastPush).getTime()
      const hours = Math.floor(ago / 3600000)
      if (!confirm(`Local data may have been modified since last push (${hours > 0 ? hours + 'h' : '<1h'} ago). Pull will overwrite local data. Continue?`)) {
        return
      }
    }
    try {
      const plan = await window.sophia.sync.planPull(getConfig())
      if (plan.deleteCount > 0) {
        const sample = plan.deleteSample.slice(0, 10).join('\n')
        const more = plan.deleteCount > 10 ? `\n... and ${plan.deleteCount - 10} more` : ''
        if (!confirm(`Pull will DELETE ${plan.deleteCount} local file(s) that no longer exist on the server:\n${sample}${more}\n\nContinue?`)) {
          return
        }
      }
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Pull planning failed' })
      return
    }
    setPulling(true)
    setResult(null)
    setProgress(null)
    try {
      const res = await window.sophia.sync.pull(getConfig())
      if (res.success) {
        setResult({ ok: true, msg: `Pulled ${res.transferred}, skipped ${res.skipped}, deleted ${res.deleted}` })
      } else {
        setResult({ ok: false, msg: `Pulled ${res.transferred}, skipped ${res.skipped}, deleted ${res.deleted}, ${res.errors.length} errors: ${res.errors[0]}` })
      }
      if (res.timestamp) {
        setLastPull(res.timestamp)
        localStorage.setItem('webdav-last-pull', res.timestamp)
      }
      onPullComplete?.()
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Pull failed' })
    } finally {
      setPulling(false)
      setProgress(null)
    }
  }

  return (
    <div className="rounded-lg border border-surface-border bg-bg-surface p-6">
      <h3 className="mb-4 text-lg font-semibold text-text-primary">WebDAV Sync</h3>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Server URL</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://dav.example.com"
            className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-border focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-border focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? 'Saved — type to replace' : 'Not set'}
              className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-border focus:outline-none"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleTest}
            disabled={testing || !url.trim()}
            className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {testResult && (
          <p className={`text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.ok ? 'OK: ' : 'Error: '}{testResult.msg}
          </p>
        )}

        <div className="border-t border-surface-border pt-3">
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={handlePush}
              disabled={pushing || !url.trim()}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {pushing ? 'Pushing...' : 'Push (Upload)'}
            </button>
            <button
              onClick={handlePull}
              disabled={pulling || !url.trim()}
              className="rounded border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated disabled:opacity-50"
            >
              {pulling ? 'Pulling...' : 'Pull (Download)'}
            </button>
          </div>

          {(pushing || pulling) && progress && progress.total > 0 && (
            <div className="mb-2">
              <div className="h-1.5 w-full overflow-hidden rounded bg-bg-deep">
                <div
                  className="h-full bg-accent transition-all duration-200"
                  style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                />
              </div>
              <p className="mt-1 truncate text-xs text-text-muted">
                {progress.current}/{progress.total} — {progress.file}
              </p>
            </div>
          )}

          <div className="text-xs text-text-muted">
            <p>Last push: {lastPush ? new Date(lastPush).toLocaleString() : 'never'}</p>
            <p>Last pull: {lastPull ? new Date(lastPull).toLocaleString() : 'never'}</p>
          </div>
        </div>

        {result && (
          <p className={`text-xs ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
            {result.ok ? 'OK: ' : 'Error: '}{result.msg}
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-text-muted">
        Password is stored encrypted via the OS keychain and never synced. API keys are never synced.
      </p>
    </div>
  )
}


function SettingsView({ onPullComplete }: { onPullComplete?: () => void }): React.ReactElement {
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

      <WebDavSyncView onPullComplete={onPullComplete} />

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

function CompanionsManageView({
  companions,
  onEdit,
  onAdd,
  onRefresh,
  onStart
}: {
  companions: Companion[]
  onEdit: (c: Companion) => void
  onAdd: () => void
  onRefresh: () => void
  onStart: (c: Companion) => void
}): React.ReactElement {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    await window.sophia.companions.delete(id)
    setDeleteConfirmId(null)
    onRefresh()
  }

  return (
    <div className="p-8">
      <h2 className="mb-6 text-2xl font-bold">角色管理</h2>
      <p className="mb-6 text-text-muted">点击角色卡片查看或编辑设定，或在底部添加自定义角色。</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {companions.map((c) => (
          <div
            key={c.id}
            className="rounded-lg border border-surface-border bg-bg-surface p-5 transition-all hover:border-accent-border hover:shadow-lg"
          >
            <button
              onClick={() => onEdit(c)}
              className="w-full text-left"
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
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => onStart(c)}
                className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
              >开始对话</button>
              {deleteConfirmId === c.id ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
                  >确认删除</button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="rounded border border-surface-border-strong px-2 py-1 text-xs text-text-muted hover:bg-bg-elevated"
                  >取消</button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirmId(c.id)}
                  className="text-xs text-text-muted hover:text-red-400"
                  title="删除角色"
                >删除</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onAdd}
        className="mt-6 w-full rounded-lg border border-dashed border-surface-border-strong px-4 py-4 text-sm text-text-muted hover:border-accent-border hover:text-accent-hover transition-colors"
      >
        + 添加自定义角色
      </button>

      {companions.length === 0 && (
        <p className="mt-4 text-text-muted">暂无可用角色。</p>
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
  const [readingTextbook, setReadingTextbook] = useState<Textbook | null>(null)
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
              {t.originalFile && (
                <button
                  onClick={() => setReadingTextbook(t)}
                  className="rounded border border-surface-border-strong px-3 py-1 text-sm hover:bg-bg-elevated"
                >
                  阅读原件
                </button>
              )}
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

      {readingTextbook && (
        <PdfReaderView
          textbookId={readingTextbook.id}
          title={readingTextbook.title}
          onClose={() => setReadingTextbook(null)}
        />
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