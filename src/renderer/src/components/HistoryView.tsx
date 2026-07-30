import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../stores/useAppStore'
import { useCompanionStore } from '../stores/useCompanionStore'
import { useTextbookStore } from '../stores/useTextbookStore'
import { WORLD_ID } from '../types/models'

export function HistoryView(): React.ReactElement {
  const [conversations, setConversations] = useState<ConversationDTO[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ results: SearchResultDTO[]; total: number } | null>(null)
  const [searching, setSearching] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedMessages, setExpandedMessages] = useState<MessageDTO[]>([])
  const [expandedArtifacts, setExpandedArtifacts] = useState<ArtifactDTO[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const setView = useAppStore((s) => s.setView)
  const setLoadConversationId = useAppStore((s) => s.setLoadConversationId)
  const setSelectedCompanion = useCompanionStore((s) => s.select)
  const setSelectedTextbook = useTextbookStore((s) => s.select)

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
    if (!await window.sophia.dialog.confirm({ message: '确定删除这个课程记录？', confirmLabel: '删除' })) return
    await window.sophia.data.deleteConversation(convId)
    setConversations((prev) => prev.filter((c) => c.id !== convId))
    if (expandedId === convId) {
      setExpandedId(null)
      setExpandedMessages([])
      setExpandedArtifacts([])
    }
  }

  const doSearch = useCallback(async (query: string, offset: number) => {
    setSearching(true)
    try {
      const result = await window.sophia.data.searchMessages(WORLD_ID, query, 50, offset)
      if (offset === 0) {
        setSearchResults(result)
      } else {
        setSearchResults((prev) =>
          prev ? { results: [...prev.results, ...result.results], total: result.total } : result
        )
      }
    } catch {
      if (offset === 0) setSearchResults({ results: [], total: 0 })
    } finally {
      setSearching(false)
    }
  }, [])

  // Debounced auto-search: 300ms after the user stops typing
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) {
      setSearchResults(null)
      return
    }
    const timer = setTimeout(() => doSearch(q, 0), 300)
    return () => clearTimeout(timer)
  }, [searchQuery, doSearch])

  const handleSearch = () => {
    const q = searchQuery.trim()
    if (q.length < 2) return
    doSearch(q, 0)
  }

  const handleLoadMore = () => {
    if (!searchResults) return
    doSearch(searchQuery.trim(), searchResults.results.length)
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

  const handleResume = async (convId: string) => {
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
  }

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

  const handleExport = async (conv: ConversationDTO) => {
    const msgs = await window.sophia.data.listMessages(conv.id)
    if (msgs.length === 0) return

    const compName = companionMap[conv.companionId] ?? conv.companionId
    const dateRange = msgs.length > 0
      ? `${new Date(msgs[0].createdAt).toLocaleDateString()} — ${new Date(msgs[msgs.length - 1].createdAt).toLocaleDateString()}`
      : ''
    const lines: string[] = [
      `# ${conv.title}`,
      '',
      `**AI 角色**: ${compName}`,
      `**对话时间**: ${dateRange}`,
      `**消息数**: ${msgs.length}`,
      '',
      '---',
      ''
    ]
    for (const msg of msgs) {
      const label = msg.role === 'user' ? '你' : msg.role === 'assistant' ? compName : '系统'
      const time = new Date(msg.createdAt).toLocaleString()
      lines.push(`### ${label} — ${time}`)
      lines.push('')
      lines.push(msg.content)
      lines.push('')
    }

    const content = lines.join('\n')
    const safeTitle = conv.title.replace(/[<>:"/\\|?*]/g, '_')
    const result = await window.sophia.dialog.saveFile({
      defaultPath: `${safeTitle}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return
    await window.sophia.data.writeTextFile(result.filePath, content)
  }

  return (
    <div className="p-8">
      <h2 className="mb-6 text-2xl font-bold">学习历史</h2>

      <div className="mb-6 flex gap-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="搜索对话内容... (输入至少 2 个字)"
          className="flex-1 rounded border border-surface-border-strong bg-bg-surface px-4 py-2 text-sm text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={searchQuery.trim().length < 2 || searching}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {searching ? '搜索中...' : '搜索'}
        </button>
      </div>

      {searchResults !== null && (
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              搜索结果 ({searchResults.results.length}/{searchResults.total})
            </h3>
            <button
              onClick={() => { setSearchResults(null); setSearchQuery('') }}
              className="text-sm text-text-muted hover:text-text-secondary"
            >
              清除
            </button>
          </div>
          {searchResults.results.length === 0 ? (
            <p className="text-text-muted">无匹配结果</p>
          ) : (
            <>
              <div className="space-y-2">
                {searchResults.results.map((r, i) => (
                  <div key={i} className="rounded-lg border border-surface-border bg-bg-surface p-3">
                    <p className="text-sm text-text-secondary">{r.message.content}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      {new Date(r.message.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
              {searchResults.results.length < searchResults.total && (
                <button
                  onClick={handleLoadMore}
                  disabled={searching}
                  className="mt-3 w-full rounded border border-surface-border-strong py-2 text-sm text-text-muted hover:bg-bg-elevated disabled:opacity-50"
                >
                  {searching ? '加载中...' : `加载更多 (还剩 ${searchResults.total - searchResults.results.length} 条)`}
                </button>
              )}
            </>
          )}
        </div>
      )}

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
                        handleResume(conv.id)
                      }}
                      className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover"
                    >
                      继续上课
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleExport(conv) }}
                    className="text-xs text-text-muted hover:text-accent-hover"
                    title="导出为 Markdown"
                  >
                    📥
                  </button>
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

            {expandedId === conv.id && (
              <div className="border-t border-surface-border px-4 py-3 space-y-3 max-h-96 overflow-auto">
                {loadingMessages ? (
                  <p className="text-xs text-text-muted">加载中...</p>
                ) : (
                  <>
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
