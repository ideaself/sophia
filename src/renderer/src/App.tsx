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
  const [hasKey, setHasKey] = useState<boolean | null>(null)
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
    window.sophia.settings.hasDeepSeekKey().then(setHasKey)
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
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Sidebar */}
      <nav className="relative flex w-56 flex-col border-r border-gray-700 bg-gray-800">
        <div className="border-b border-gray-700 p-4">
          <h1 className="text-lg font-bold">Sophia</h1>
          <p className="text-xs text-gray-400">AI 苏格拉底式学习伴侣</p>
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
        <div className="border-t border-gray-700 p-3 text-xs text-gray-500">
          {hasKey === null ? (
            <span>检查 API Key...</span>
          ) : hasKey ? (
            <span className="text-green-400">● API Key 已配置</span>
          ) : (
            <span className="text-yellow-400">● 需要 API Key</span>
          )}
        </div>

        {/* Classroom dropdown */}
        {showClassroomDropdown && (
          <div
            ref={dropdownRef}
            className="absolute left-full top-0 z-50 ml-1 w-72 rounded-lg border border-gray-600 bg-gray-800 shadow-xl"
          >
            <div className="border-b border-gray-700 p-3">
              <h3 className="text-sm font-semibold">选择课堂</h3>
            </div>
            <div className="max-h-80 overflow-auto p-2">
              <button
                onClick={() => handleNewClassroom()}
                className="mb-1 w-full rounded-md border border-dashed border-gray-600 px-3 py-2 text-left text-sm text-gray-300 hover:border-blue-500 hover:text-blue-400"
              >
                + 新建课堂
              </button>
              {activeConversations.length === 0 && (
                <p className="px-3 py-2 text-xs text-gray-500">没有进行中的课堂</p>
              )}
              {activeConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleResumeConversation(conv)}
                  className="w-full rounded-md px-3 py-2 text-left hover:bg-gray-700"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{conv.companionName}</span>
                    {conv.textbookTitle && (
                      <span className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">
                        📖 {conv.textbookTitle}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-400 truncate">{conv.title}</p>
                  <p className="mt-0.5 text-[10px] text-gray-500">
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
        {view === 'settings' && <SettingsView onKeySet={() => setHasKey(true)} />}
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
            ? 'bg-blue-600 text-white'
            : disabled
              ? 'cursor-not-allowed text-gray-600'
              : 'text-gray-300 hover:bg-gray-700'
        }`}
      >
        {label}
      </button>
    </li>
  )
}

// ─── Settings View ───────────────────────────────────────────────

function SettingsView({ onKeySet }: { onKeySet: () => void }): React.ReactElement {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasKey, setHasKey] = useState(false)

  useEffect(() => {
    window.sophia.settings.hasDeepSeekKey().then(setHasKey)
  }, [])

  const handleSave = async () => {
    if (!key.trim()) {
      setError('API Key 不能为空')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await window.sophia.settings.setDeepSeekKey(key.trim())
      setKey('')
      setHasKey(true)
      onKeySet()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await window.sophia.settings.deleteDeepSeekKey()
      setHasKey(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div className="mx-auto max-w-xl p-8">
      <h2 className="mb-6 text-2xl font-bold">设置</h2>

      <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
        <h3 className="mb-4 text-lg font-semibold">DeepSeek API Key</h3>

        {hasKey && (
          <div className="mb-4 rounded border border-green-800 bg-green-900/30 px-4 py-2 text-sm text-green-300">
            API Key 已配置。您可以随时更新或删除它。
          </div>
        )}

        <div className="space-y-3">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-..."
            className="w-full rounded border border-gray-600 bg-gray-900 px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>

            {hasKey && (
              <button
                onClick={handleDelete}
                className="rounded border border-red-700 px-4 py-2 text-sm text-red-400 hover:bg-red-900/30"
              >
                删除 Key
              </button>
            )}
          </div>
        </div>

        <p className="mt-4 text-xs text-gray-500">
          API Key 仅保存在本地，使用系统加密存储。不会上传到任何服务器。
        </p>
      </div>
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
      <p className="mb-6 text-gray-400">选择一个苏格拉底式的学习伙伴开始上课。</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {companions.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className={`rounded-lg border p-5 text-left transition-all hover:border-blue-500 hover:shadow-lg ${
              selected?.id === c.id
                ? 'border-blue-500 bg-blue-900/20'
                : 'border-gray-700 bg-gray-800'
            }`}
          >
            <h3 className="text-lg font-semibold">{c.name}</h3>
            <p className="mt-1 text-sm text-gray-400">{c.identity}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {c.personalityKeywords.map((kw) => (
                <span
                  key={kw}
                  className="rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300"
                >
                  {kw}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      {companions.length === 0 && (
        <p className="text-gray-500">暂无可用角色。请检查 reference 目录。</p>
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

  return (
    <div className="p-8">
      <h2 className="mb-6 text-2xl font-bold">教材</h2>

      {/* Import form */}
      <div className="mb-8 rounded-lg border border-gray-700 bg-gray-800 p-6">
        <h3 className="mb-4 text-lg font-semibold">导入教材</h3>
        <div className="space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="教材标题（从文件导入时可留空）"
            className="w-full rounded border border-gray-600 bg-gray-900 px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="粘贴 Markdown 或文本内容..."
            rows={6}
            className="w-full rounded border border-gray-600 bg-gray-900 px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <div className="flex gap-3">
            <button
              onClick={handleTextImport}
              disabled={importing || !title.trim() || !content.trim()}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
            className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 p-4"
          >
            <div>
              <h4 className="font-medium">{t.title}</h4>
              <p className="text-xs text-gray-500">{t.format}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleViewContent(t)}
                className="rounded border border-gray-600 px-3 py-1 text-sm hover:bg-gray-700"
              >
                查看
              </button>
              <button
                onClick={() => onSelect(t)}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
              >
                选择
              </button>
            </div>
          </div>
        ))}
        {textbooks.length === 0 && (
          <p className="text-gray-500">暂无教材。请在上方导入。</p>
        )}
      </div>

      {/* Textbook content viewer modal */}
      {viewingTextbook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex h-[80vh] w-[80vw] flex-col rounded-lg border border-gray-600 bg-gray-900 shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold">{viewingTextbook.title}</h3>
                <p className="text-xs text-gray-400">{viewingTextbook.format}</p>
              </div>
              <button
                onClick={() => setViewingTextbook(null)}
                className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4">
              {loadingContent ? (
                <p className="text-sm text-gray-500">加载中...</p>
              ) : (
                <div className="markdown-body text-sm leading-relaxed text-gray-200">
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
  const [loadingMessages, setLoadingMessages] = useState(false)

  useEffect(() => {
    window.sophia.data.listConversations(WORLD_ID).then(setConversations)
  }, [])

  const handleSearch = async () => {
    if (searchQuery.trim().length < 2) return
    const results = await window.sophia.data.searchMessages(WORLD_ID, searchQuery.trim())
    setSearchResults(results)
  }

  const handleToggleMessages = async (convId: string) => {
    if (expandedId === convId) {
      setExpandedId(null)
      setExpandedMessages([])
      return
    }
    setLoadingMessages(true)
    setExpandedId(convId)
    try {
      const msgs = await window.sophia.data.listMessages(convId)
      setExpandedMessages(msgs)
    } catch {
      setExpandedMessages([])
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
          className="flex-1 rounded border border-gray-600 bg-gray-800 px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={searchQuery.trim().length < 2}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
              className="text-sm text-gray-400 hover:text-gray-200"
            >
              清除
            </button>
          </div>
          {searchResults.length === 0 ? (
            <p className="text-gray-500">无匹配结果</p>
          ) : (
            <div className="space-y-2">
              {searchResults.map((r, i) => (
                <div key={i} className="rounded-lg border border-gray-700 bg-gray-800 p-3">
                  <p className="text-sm text-gray-200">{r.message.content}</p>
                  <p className="mt-1 text-xs text-gray-500">
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
            className="rounded-lg border border-gray-700 bg-gray-800"
          >
            <button
              onClick={() => handleToggleMessages(conv.id)}
              className="w-full p-4 text-left"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">{conv.title}</h4>
                  <p className="text-xs text-gray-500">
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
                      className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
                    >
                      继续上课
                    </button>
                  )}
                  <span className="text-gray-500 text-xs">
                    {expandedId === conv.id ? '▾' : '▸'}
                  </span>
                </div>
              </div>
            </button>

            {/* Expanded message list */}
            {expandedId === conv.id && (
              <div className="border-t border-gray-700 px-4 py-3 space-y-2 max-h-96 overflow-auto">
                {loadingMessages ? (
                  <p className="text-xs text-gray-500">加载中...</p>
                ) : expandedMessages.length === 0 ? (
                  <p className="text-xs text-gray-500">暂无消息记录</p>
                ) : (
                  expandedMessages.map((msg) => (
                    <div key={msg.id} className={`rounded px-3 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-blue-900/20 ml-8'
                        : msg.role === 'assistant'
                          ? 'bg-gray-700 mr-8'
                          : 'bg-gray-800 text-gray-400'
                    }`}>
                      <p className="text-xs text-gray-500 mb-1">
                        {msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : '系统'} · {new Date(msg.createdAt).toLocaleTimeString()}
                      </p>
                      <p className="text-gray-200 whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
        {conversations.length === 0 && (
          <p className="text-gray-500">暂无历史记录。</p>
        )}
      </div>
    </div>
  )
}

export default App
