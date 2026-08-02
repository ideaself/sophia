import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ClassroomView } from './chat/ClassroomView'
import { useChatStream } from './chat/useChatStream'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { useDueFlashcardCount } from './hooks/useFlashcards'
import { CompanionEditModal } from './components/CompanionEditModal'
import { SettingsView } from './components/SettingsView'
import { CompanionsManageView } from './components/CompanionsManageView'
import { TextbooksView } from './components/TextbooksView'
import { HistoryView } from './components/HistoryView'
import { FlashcardReviewView } from './components/FlashcardReviewView'
import { StatsView } from './components/StatsView'
import { useAppStore } from './stores/useAppStore'
import { useCompanionStore } from './stores/useCompanionStore'
import { useTextbookStore } from './stores/useTextbookStore'
import { useConversationStore } from './stores/useConversationStore'
import { WORLD_ID, type ActiveConversation, type Companion, type Textbook } from './types/models'
import { applyFontScale } from '../../shared/font-scale'

function App(): React.ReactElement {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const showClassroomDropdown = useAppStore((s) => s.showClassroomDropdown)
  const setShowClassroomDropdown = useAppStore((s) => s.setShowClassroomDropdown)
  const loadConversationId = useAppStore((s) => s.loadConversationId)
  const setLoadConversationId = useAppStore((s) => s.setLoadConversationId)
  const classroomResetKey = useAppStore((s) => s.classroomResetKey)
  const incrementResetKey = useAppStore((s) => s.incrementResetKey)
  const flashcardScope = useAppStore((s) => s.flashcardScope)
  const setFlashcardScope = useAppStore((s) => s.setFlashcardScope)

  // Profile lock (3.0.0) — startup gate + re-lock via window event.
  const [lockState, setLockState] = useState<'checking' | 'locked' | 'unlocked'>('checking')

  useEffect(() => {
    window.sophia.data.lock.has().then((has) => {
      setLockState(has ? 'locked' : 'unlocked')
    }).catch(() => setLockState('unlocked'))
  }, [])

  useEffect(() => {
    const onRelock = () => setLockState('locked')
    window.addEventListener('sophia:relock', onRelock)
    return () => window.removeEventListener('sophia:relock', onRelock)
  }, [])

  const selectedCompanion = useCompanionStore((s) => s.selectedCompanion)
  const setSelectedCompanion = useCompanionStore((s) => s.select)
  const editingCompanion = useCompanionStore((s) => s.editingCompanion)
  const isCreatingCompanion = useCompanionStore((s) => s.isCreating)
  const fetchCompanions = useCompanionStore((s) => s.fetch)
  const startEditCompanion = useCompanionStore((s) => s.startEdit)
  const startCreateCompanion = useCompanionStore((s) => s.startCreate)
  const closeEditCompanion = useCompanionStore((s) => s.closeEdit)
  const saveCompanion = useCompanionStore((s) => s.save)
  const removeCompanion = useCompanionStore((s) => s.remove)

  const selectedTextbook = useTextbookStore((s) => s.selectedTextbook)
  const setSelectedTextbook = useTextbookStore((s) => s.select)
  const fetchTextbooks = useTextbookStore((s) => s.fetch)

  const fetchActiveConversations = useConversationStore((s) => s.fetchActive)

  const chatStream = useChatStream()
  const isOnline = useOnlineStatus()
  const dueFlashcardCount = useDueFlashcardCount()
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

  useEffect(() => {
    const saved = localStorage.getItem('sophia-theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved)
  }, [])

  // Global UI font scale (1.0.7 / 3.2.0)
  useEffect(() => {
    applyFontScale()
  }, [])

  useEffect(() => {
    fetchCompanions()
    fetchTextbooks()
  }, [])

  useEffect(() => {
    if (!showClassroomDropdown) return
    const clickHandler = (e: MouseEvent) => {
      if (classroomDropdownRef.current && !classroomDropdownRef.current.contains(e.target as Node)) {
        setShowClassroomDropdown(false)
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowClassroomDropdown(false)
    }
    document.addEventListener('mousedown', clickHandler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', clickHandler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [showClassroomDropdown])

  const handleResumeConversation = async (conv: ActiveConversation) => {
    const comp = await window.sophia.companions.get(conv.companionId)
    if (comp) setSelectedCompanion({ id: comp.id, name: comp.name, identity: comp.identity, personalityKeywords: comp.personalityKeywords })
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
      incrementResetKey()
      setView('classroom')
    } else {
      setView('companions')
    }
    setShowClassroomDropdown(false)
  }

  const handleClassroomClick = async () => {
    if (selectedCompanion) {
      const fresh = await window.sophia.companions.get(selectedCompanion.id).catch(() => null)
      if (fresh) setSelectedCompanion({ id: fresh.id, name: fresh.name, identity: fresh.identity, personalityKeywords: fresh.personalityKeywords })
      else setSelectedCompanion(null)
    }
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
    if (full) startEditCompanion(full)
  }

  const activeConversations = useConversationStore((s) => s.activeConversations)

  const onConversationLoaded = useCallback(() => {
    setLoadConversationId(null)
  }, [])

  return (
    <div className="flex h-screen flex-col bg-bg-deep text-text-primary">
      {lockState !== 'unlocked' && (
        lockState === 'checking'
          ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-deep text-text-muted">加载中…</div>
          : <LockScreen onUnlock={() => setLockState('unlocked')} />
      )}
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

          <button onClick={() => { setView('flashcards'); setFlashcardScope(null); setShowClassroomDropdown(false) }}
            className={`rounded px-3 py-2 text-sm transition-colors ${view === 'flashcards' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-elevated'}`}>
            复习
            {dueFlashcardCount > 0 && (
              <span
                className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white"
                title={`今天有 ${dueFlashcardCount} 张卡片待复习`}
              >
                {dueFlashcardCount > 99 ? '99+' : dueFlashcardCount}
              </span>
            )}
          </button>

          <button onClick={() => { setView('stats'); setShowClassroomDropdown(false) }}
            className={`rounded px-3 py-2 text-sm transition-colors ${view === 'stats' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-elevated'}`}>
            统计
          </button>

          <button onClick={() => { setView('settings'); setShowClassroomDropdown(false) }}
            className={`rounded px-3 py-2 text-sm transition-colors ${view === 'settings' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-elevated'}`}>
            设置
          </button>
        </nav>
      </header>

      {!isOnline && (
        <div className="border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-1.5 text-center text-xs text-yellow-400">
          网络连接已断开——发送消息、生成 artifacts、WebDAV 同步暂不可用，恢复联网后自动继续
        </div>
      )}

      <main className="flex-1 overflow-auto">
        <ErrorBoundary>
          {view === 'settings' && <SettingsView />}
          {view === 'companions' && <CompanionsManageView />}
          {view === 'textbooks' && <TextbooksView />}
          {view === 'history' && <HistoryView />}
          {view === 'flashcards' && (
            <FlashcardReviewView scope={flashcardScope} onClearScope={() => setFlashcardScope(null)} />
          )}
          {view === 'stats' && <StatsView />}
          {view === 'classroom' && (
            <div key={classroomResetKey} className="h-full">
              <ClassroomView companion={selectedCompanion} textbook={selectedTextbook} chatStream={chatStream}
                loadConversationId={loadConversationId} onConversationLoaded={onConversationLoaded} />
            </div>
          )}
        </ErrorBoundary>
      </main>

      {(editingCompanion || isCreatingCompanion) && (
        <CompanionEditModal companion={editingCompanion} isCreating={isCreatingCompanion}
          onSave={saveCompanion} onDelete={!isCreatingCompanion ? removeCompanion : undefined}
          onClose={closeEditCompanion} />
      )}
    </div>
  )
}

export default App

function LockScreen({ onUnlock }: { onUnlock: () => void }): React.ReactElement {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !pin) return
    setBusy(true)
    setError(false)
    try {
      const ok = await window.sophia.data.lock.verify(pin)
      if (ok) {
        onUnlock()
      } else {
        setError(true)
        setPin('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-deep">
      <form
        onSubmit={submit}
        className="w-72 rounded-xl border border-surface-border bg-bg-surface p-6 shadow-xl"
      >
        <h2 className="mb-1 text-lg font-semibold">学习档案已锁定</h2>
        <p className="mb-4 text-xs text-text-muted">请输入解锁密码继续使用</p>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoFocus
          placeholder="解锁密码"
          className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-red-400">密码错误，请重试</p>}
        <button
          type="submit"
          disabled={busy || !pin}
          className="mt-4 w-full rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? '验证中...' : '解锁'}
        </button>
      </form>
    </div>
  )
}
