import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { normalizeMathDelimiters } from '../../../shared/math-delimiters'
import { handleCopyMathSource } from '../lib/mathCopy'
import { useAppStore } from '../stores/useAppStore'
import { useCompanionStore } from '../stores/useCompanionStore'
import { useTextbookStore } from '../stores/useTextbookStore'
import { WORLD_ID } from '../types/models'
import { ArtifactType } from '../../../shared/types/ids'
import { parseSelfTestQuestions } from '../../../shared/self-test-utils'
import { SelfTestModal } from './SelfTestModal'

const MarkdownRenderer = lazy(() => import('../lib/MarkdownRenderer'))

/** Artifact types persisted as standalone artifacts (redo-able from history). */
const STORED_ARTIFACT_TYPES = [
  ArtifactType.LessonSummary,
  ArtifactType.Flashcards,
  ArtifactType.Diary,
  ArtifactType.Progress,
  ArtifactType.HandoffTail,
  ArtifactType.CompanionNote
]

interface GroupedConversation {
  /** textbookId 或 'none'（未绑定教材） */
  key: string
  title: string
  conversations: ConversationDTO[]
}

/**
 * 课堂浏览器 —— 以教材为主题组织课堂（类似原版）：
 * 左侧树（新建课堂 + 按书分组展开课堂，命名 = 日期 + 角色名 + 条数），
 * 右侧显示所选课堂的对话与产物。
 */
export function HistoryView(): React.ReactElement {
  const [conversations, setConversations] = useState<ConversationDTO[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [msgs, setMsgs] = useState<MessageDTO[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactDTO[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [msgCounts, setMsgCounts] = useState<Record<string, number>>({})
  // 搜索
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ results: SearchResultDTO[]; total: number } | null>(null)
  const [searching, setSearching] = useState(false)
  // 产物编辑
  const [editingArtifact, setEditingArtifact] = useState<{ conversationId: string; artifactId: string } | null>(null)
  const [editArtifactText, setEditArtifactText] = useState('')
  // 自测 / 补齐缺失 / 日记 / 提示
  const [selfTestOpen, setSelfTestOpen] = useState(false)
  const [selfTestQuestions, setSelfTestQuestions] = useState<ReturnType<typeof parseSelfTestQuestions>>([])
  const [redoingMissing, setRedoingMissing] = useState(false)
  const [diaryMonths, setDiaryMonths] = useState<string[]>([])
  const [openDiaryMonth, setOpenDiaryMonth] = useState<string | null>(null)
  const [diaryMonthContent, setDiaryMonthContent] = useState<string | null>(null)
  const [loadingDiary, setLoadingDiary] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const setView = useAppStore((s) => s.setView)
  const setLoadConversationId = useAppStore((s) => s.setLoadConversationId)
  const setSelectedCompanion = useCompanionStore((s) => s.select)
  const setSelectedTextbook = useTextbookStore((s) => s.select)
  const textbooks = useTextbookStore((s) => s.textbooks)
  const fetchTextbooks = useTextbookStore((s) => s.fetch)

  useEffect(() => {
    window.sophia.data.listConversations(WORLD_ID).then((convs) => {
      setConversations(convs)
      // 默认选中最近的一个课堂
      if (convs.length > 0 && !selectedId) {
        setSelectedId(convs[0].id)
      }
    })
    window.sophia.data.diary.listMonths(WORLD_ID).then(setDiaryMonths)
    fetchTextbooks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 角色名 / 书名映射
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

  const textbookTitleMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const tb of textbooks) map[tb.id] = tb.title
    return map
  }, [textbooks])

  // 每课堂消息数（用于"N 条"显示），并行加载
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const counts: Record<string, number> = {}
      await Promise.all(
        conversations.map(async (c) => {
          try {
            const msgs = await window.sophia.data.listMessages(c.id)
            counts[c.id] = msgs.length
          } catch {
            counts[c.id] = 0
          }
        })
      )
      if (!cancelled) setMsgCounts(counts)
    })()
    return () => { cancelled = true }
  }, [conversations])

  // 按教材分组（含"未绑定教材"）
  const groups = useMemo<GroupedConversation[]>(() => {
    const byKey = new Map<string, GroupedConversation>()
    for (const conv of conversations) {
      const key = conv.textbookId ?? 'none'
      let g = byKey.get(key)
      if (!g) {
        g = {
          key,
          title: key === 'none' ? '未绑定教材' : (textbookTitleMap[key] ?? '未知教材'),
          conversations: []
        }
        byKey.set(key, g)
      }
      g.conversations.push(conv)
    }
    const list = [...byKey.values()]
    for (const g of list) {
      g.conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    }
    list.sort((a, b) => (a.key === 'none' ? 1 : 0) - (b.key === 'none' ? 1 : 0) || a.title.localeCompare(b.title, 'zh'))
    return list
  }, [conversations, textbookTitleMap])

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** 课堂显示名：MM-DD 角色名 */
  const displayName = (conv: ConversationDTO): string => {
    const d = new Date(conv.createdAt)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${mm}-${dd} ${companionMap[conv.companionId] ?? conv.companionId}`
  }

  const selectConversation = async (convId: string) => {
    setSelectedId(convId)
    setEditingArtifact(null)
    setLoadingDetail(true)
    try {
      const [msgs, arts] = await Promise.all([
        window.sophia.data.listMessages(convId).catch(() => [] as MessageDTO[]),
        window.sophia.data.listArtifacts(convId).catch(() => [] as ArtifactDTO[])
      ])
      setMsgs(msgs)
      setArtifacts(arts)
    } finally {
      setLoadingDetail(false)
    }
  }

  const selected = conversations.find((c) => c.id === selectedId) ?? null

  // --- 操作 ---

  const handleNewClassroom = () => {
    useAppStore.getState().setNewClassroomOpen(true)
  }

  const handleResume = async (convId: string) => {
    const conv = await window.sophia.data.getConversation(convId)
    if (!conv) return
    const comp = await window.sophia.companions.get(conv.companionId)
    if (comp) setSelectedCompanion({ id: comp.id, name: comp.name, identity: comp.identity, personalityKeywords: comp.personalityKeywords })
    if (conv.textbookId) {
      const tb = await window.sophia.data.getTextbook(conv.textbookId)
      if (tb) setSelectedTextbook({ id: tb.id, title: tb.title, format: tb.format, originalFile: tb.originalFile })
    } else { setSelectedTextbook(null) }
    setLoadConversationId(convId)
    setView('classroom')
  }

  const handleContinueLearning = async (conv: ConversationDTO) => {
    try {
      const comp = await window.sophia.companions.get(conv.companionId)
      if (comp) setSelectedCompanion({ id: comp.id, name: comp.name, identity: comp.identity, personalityKeywords: comp.personalityKeywords })
    } catch { /* keep current selection */ }
    if (conv.textbookId) {
      try {
        const tb = await window.sophia.data.getTextbook(conv.textbookId)
        if (tb) setSelectedTextbook({ id: tb.id, title: tb.title, format: tb.format, originalFile: tb.originalFile })
      } catch { /* keep current selection */ }
    } else {
      setSelectedTextbook(null)
    }
    setLoadConversationId(null)
    useAppStore.getState().beginNewClassroom()
    setView('classroom')
  }

  const handleDeleteConversation = async (convId: string) => {
    if (!await window.sophia.dialog.confirm({ message: '确定删除这个课程记录？', confirmLabel: '删除' })) return
    await window.sophia.data.deleteConversation(convId)
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== convId)
      if (selectedId === convId) {
        setSelectedId(next[0]?.id ?? null)
        setMsgs([])
        setArtifacts([])
      }
      return next
    })
    setNotice('课程已删除，数据已移入历史归档，可在「设置 → 历史归档」恢复。')
    setTimeout(() => setNotice(null), 5000)
  }

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
      lines.push(`### ${label} — ${new Date(msg.createdAt).toLocaleString()}`)
      lines.push('')
      lines.push(msg.content)
      lines.push('')
    }
    const safeTitle = conv.title.replace(/[<>:"/\\|?*]/g, '_')
    const result = await window.sophia.dialog.saveFile({
      defaultPath: `${safeTitle}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return
    await window.sophia.data.writeTextFile(result.filePath, lines.join('\n'))
  }

  const savePdf = async (html: string, defaultName: string) => {
    const safe = defaultName.replace(/[<>:"/\\|?*]/g, '_')
    const result = await window.sophia.dialog.saveFile({
      defaultPath: `${safe}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return
    await window.sophia.data.exportPdf(html, result.filePath)
  }

  /** Markdown → HTML for PDF export (markdownToHtml is code-split; PDF export is rare). */
  const renderHtml = (md: string) => import('../lib/markdownToHtml').then((m) => m.markdownToHtml(md))

  const handleExportPdf = async (conv: ConversationDTO) => {
    const msgs = await window.sophia.data.listMessages(conv.id)
    if (msgs.length === 0) return
    const compName = companionMap[conv.companionId] ?? conv.companionId
    const parts: string[] = [
      `<h1>${escapeHtml(conv.title)}</h1>`,
      `<p>AI 角色：${escapeHtml(compName)} · 消息数：${msgs.length}</p>`
    ]
    for (const msg of msgs) {
      const label = msg.role === 'user' ? '你' : msg.role === 'assistant' ? compName : '系统'
      parts.push(`<h3>${escapeHtml(label)} — ${escapeHtml(new Date(msg.createdAt).toLocaleString())}</h3>`)
      parts.push(await renderHtml(msg.content))
    }
    await savePdf(parts.join('\n'), conv.title)
  }

  const handleExportArtifactPdf = async (conv: ConversationDTO, content: string) => {
    const html = `<h1>${escapeHtml(conv.title)} · 课后笔记</h1>\n` + await renderHtml(content)
    await savePdf(html, `${conv.title}_笔记`)
  }

  // --- 搜索 ---
  const doSearch = useCallback(async (query: string, offset: number) => {
    setSearching(true)
    try {
      const result = await window.sophia.data.searchMessages(WORLD_ID, query, 50, offset)
      if (offset === 0) setSearchResults(result)
      else setSearchResults((prev) => prev ? { results: [...prev.results, ...result.results], total: result.total } : result)
    } catch {
      if (offset === 0) setSearchResults({ results: [], total: 0 })
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) { setSearchResults(null); return }
    const timer = setTimeout(() => doSearch(q, 0), 300)
    return () => clearTimeout(timer)
  }, [searchQuery, doSearch])

  // --- 产物操作 ---
  const handleStartArtifactEdit = (artifact: ArtifactDTO) => {
    if (!selected) return
    setEditingArtifact({ conversationId: selected.id, artifactId: artifact.id })
    setEditArtifactText(artifact.content)
  }

  const handleSaveArtifact = async () => {
    if (!editingArtifact || !editArtifactText.trim()) return
    await window.sophia.data.updateArtifact(editingArtifact.artifactId, editingArtifact.conversationId, editArtifactText.trim())
    setArtifacts((prev) => prev.map((a) => a.id === editingArtifact.artifactId ? { ...a, content: editArtifactText.trim() } : a))
    setEditingArtifact(null)
  }

  const handleRedoMissingArtifacts = async () => {
    if (!selected || redoingMissing) return
    const missing = STORED_ARTIFACT_TYPES.filter((t) => !artifacts.some((a) => a.type === t))
    if (missing.length === 0) return
    setRedoingMissing(true)
    try {
      const result = await window.sophia.data.redoArtifacts(selected.id, missing, WORLD_ID)
      if (result.success) {
        setArtifacts(await window.sophia.data.listArtifacts(selected.id))
      }
    } catch {
      // retry from the button
    } finally {
      setRedoingMissing(false)
    }
  }

  // --- 日记 ---
  const handleToggleDiaryMonth = async (month: string) => {
    if (openDiaryMonth === month) {
      setOpenDiaryMonth(null)
      setDiaryMonthContent(null)
      return
    }
    setLoadingDiary(true)
    setOpenDiaryMonth(month)
    try {
      setDiaryMonthContent(await window.sophia.data.diary.getMonth(month))
    } catch {
      setDiaryMonthContent(null)
    } finally {
      setLoadingDiary(false)
    }
  }

  const ARTIFACT_LABEL: Record<string, string> = {
    lesson_summary: '📋 课堂总结',
    flashcards: '🃏 记忆卡片',
    diary: '📝 学习日记',
    progress: '📈 学习进展',
    handoff_tail: '🔗 接力尾巴',
    farewell: '👋 告别语',
    learner_profile: '👤 学习者画像',
    pal_moments: '💭 互动备忘',
    relation: '💞 关系状态',
    companion_note: '🤔 伙伴独白',
    feynman_note: '🥚 费曼知识蛋',
    knowledge_graph: '🧠 知识点图谱'
  }

  return (
    <div className="flex h-full">
      {/* ===== 左侧树 ===== */}
      <aside className="flex w-72 flex-col border-r border-surface-border bg-bg-surface">
        <div className="space-y-2 border-b border-surface-border p-3">
          <button
            onClick={handleNewClassroom}
            className="w-full rounded-lg border border-dashed border-surface-border-strong px-3 py-2 text-sm font-medium text-accent-hover hover:border-accent-border hover:bg-accent-subtle"
          >
            + 新建课堂
          </button>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索对话内容..."
            className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-1.5 text-xs text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-auto p-2">
          {searchResults !== null ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs text-text-muted">结果 {searchResults.results.length}/{searchResults.total}</span>
                <button onClick={() => { setSearchResults(null); setSearchQuery('') }} className="text-xs text-text-muted hover:text-text-secondary">清除</button>
              </div>
              {searchResults.results.length === 0 && <p className="px-2 py-2 text-xs text-text-muted">无匹配结果</p>}
              {searchResults.results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => { setSearchResults(null); setSearchQuery(''); void selectConversation(r.conversationId) }}
                  className="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-elevated"
                  title={r.message.content}
                >
                  {new Date(r.message.createdAt).toLocaleString()}
                </button>
              ))}
              {searchResults.results.length < searchResults.total && (
                <button
                  onClick={() => doSearch(searchQuery.trim(), searchResults.results.length)}
                  disabled={searching}
                  className="w-full rounded border border-surface-border-strong py-1 text-xs text-text-muted hover:bg-bg-elevated disabled:opacity-50"
                >
                  {searching ? '加载中...' : '加载更多'}
                </button>
              )}
            </div>
          ) : groups.length === 0 ? (
            <p className="px-2 py-3 text-xs text-text-muted">还没有课堂。点击上方「新建课堂」开始学习。</p>
          ) : (
            <div className="space-y-1">
              {groups.map((g) => {
                const collapsed = collapsedGroups.has(g.key)
                const activeInGroup = g.conversations.filter((c) => !c.endedAt).length
                return (
                  <div key={g.key}>
                    <button
                      onClick={() => toggleGroup(g.key)}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm font-medium text-text-secondary hover:bg-bg-elevated"
                    >
                      <span className="text-xs text-text-muted">{collapsed ? '▸' : '▾'}</span>
                      <span className="truncate">📖 {g.title}</span>
                      <span className="ml-auto flex-shrink-0 text-[10px] text-text-muted">
                        {g.conversations.length}
                        {activeInGroup > 0 && <span className="ml-1 text-accent">●{activeInGroup}</span>}
                      </span>
                    </button>
                    {!collapsed && (
                      <ul className="ml-3 space-y-0.5 border-l border-surface-border pl-2">
                        {g.conversations.map((conv) => {
                          const active = !conv.endedAt
                          const isSelected = selectedId === conv.id
                          return (
                            <li key={conv.id}>
                              <button
                                onClick={() => void selectConversation(conv.id)}
                                className={`block w-full rounded px-2 py-1.5 text-left transition-colors ${
                                  isSelected ? 'bg-accent-subtle' : 'hover:bg-bg-elevated'
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-[10px] ${active ? 'text-accent' : 'text-text-muted'}`} title={active ? '进行中' : '已下课'}>
                                    {active ? '●' : '○'}
                                  </span>
                                  <span className="truncate text-xs font-medium text-text-primary">
                                    {displayName(conv)}
                                  </span>
                                </div>
                                <p className="mt-0.5 truncate pl-3 text-[10px] text-text-muted">
                                  {msgCounts[conv.id] ?? '…'} 条
                                  {conv.title && conv.title.trim() && ` · ${conv.title}`}
                                </p>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 底部：日记入口 */}
        <div className="border-t border-surface-border p-2">
          <button
            onClick={() => { setSelectedId(null); setMsgs([]); setArtifacts([]) }}
            className={`block w-full rounded px-2 py-1.5 text-left text-sm font-medium ${selectedId === null && !openDiaryMonth ? 'bg-accent-subtle text-text-primary' : 'text-text-secondary hover:bg-bg-elevated'}`}
          >
            📝 学习日记
          </button>
        </div>
      </aside>

      {/* ===== 右侧详情 ===== */}
      <main className="flex-1 overflow-auto">
        {notice && (
          <div className="border-b border-green-800 bg-green-900/20 px-4 py-2 text-sm text-green-300">{notice}</div>
        )}

        {selectedId === null ? (
          <div className="p-8">
            <h2 className="mb-4 text-xl font-bold">学习日记</h2>
            {diaryMonths.length === 0 ? (
              <p className="text-sm text-text-muted">还没有日记。每次下课后会自动按月份归档到 diary/YYYY-MM.md。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {diaryMonths.map((month) => (
                  <button
                    key={month}
                    onClick={() => handleToggleDiaryMonth(month)}
                    className={`rounded border px-3 py-1.5 text-xs transition-colors ${
                      openDiaryMonth === month ? 'border-accent bg-accent-subtle text-accent-hover' : 'border-surface-border-strong text-text-secondary hover:bg-bg-elevated'
                    }`}
                  >
                    {month}
                  </button>
                ))}
              </div>
            )}
            {openDiaryMonth && (
              <div className="mt-3 max-h-[60vh] overflow-auto rounded-lg border border-surface-border bg-bg-surface p-4">
                {loadingDiary ? (
                  <p className="text-xs text-text-muted">加载中...</p>
                ) : diaryMonthContent ? (
                  <div className="markdown-body text-sm text-text-secondary" onCopy={handleCopyMathSource}>
                    <Suspense fallback={null}>
                      <MarkdownRenderer>
                        {normalizeMathDelimiters(diaryMonthContent)}
                      </MarkdownRenderer>
                    </Suspense>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">该月暂无日记。</p>
                )}
              </div>
            )}
          </div>
        ) : selected ? (
          <div className="flex h-full flex-col">
            {/* 详情 header */}
            <div className="border-b border-surface-border bg-bg-surface px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-bold">{displayName(selected)}</h2>
                    {selected.endedAt ? (
                      <span className="rounded-full bg-amber-900/30 px-2 py-0.5 text-xs text-text-secondary">已下课</span>
                    ) : (
                      <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs text-accent-hover">进行中</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {selected.textbookId ? `📖 ${textbookTitleMap[selected.textbookId] ?? '未知教材'} · ` : ''}
                    {new Date(selected.createdAt).toLocaleString()}
                    {selected.title && selected.title.trim() && ` · ${selected.title}`}
                    {' · '}{msgCounts[selected.id] ?? '…'} 条消息
                  </p>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                  {selected.endedAt ? (
                    <button
                      onClick={() => void handleContinueLearning(selected)}
                      className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                      title="同一本教材、同一位伙伴开一节新课堂"
                    >
                      继续学习
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleResume(selected.id)}
                      className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                    >
                      继续上课
                    </button>
                  )}
                  <button
                    onClick={() => {
                      useAppStore.getState().setReviewScope({ conversationId: selected.id, title: selected.title })
                      setView('review')
                    }}
                    className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated"
                    title="课程复盘：总结 / 自测 / 闪卡 / 日记一页回顾"
                  >
                    📋 复盘
                  </button>
                  <button
                    onClick={() => void handleExport(selected)}
                    className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated"
                    title="导出为 Markdown"
                  >
                    📥 MD
                  </button>
                  <button
                    onClick={() => void handleExportPdf(selected)}
                    className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated"
                    title="导出为 PDF（含公式渲染）"
                  >
                    📄 PDF
                  </button>
                  <button
                    onClick={() => void handleDeleteConversation(selected.id)}
                    className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30"
                  >
                    🗑 删除
                  </button>
                </div>
              </div>
            </div>

            {/* 详情内容 */}
            <div className="flex-1 space-y-4 overflow-auto p-6">
              {loadingDetail ? (
                <p className="text-sm text-text-muted">加载中...</p>
              ) : (
                <>
                  {/* 产物 */}
                  {artifacts.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-text-primary">学习资料</h3>
                      {selected.endedAt &&
                        STORED_ARTIFACT_TYPES.some((t) => !artifacts.some((a) => a.type === t)) && (
                          <div className="flex items-center justify-between rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2">
                            <p className="text-xs text-text-secondary">有学习摘要缺失，可只补齐缺失项</p>
                            <button
                              onClick={() => void handleRedoMissingArtifacts()}
                              disabled={redoingMissing}
                              className="flex-shrink-0 rounded bg-amber-700 px-3 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
                            >
                              {redoingMissing ? '补齐中...' : '补齐缺失产物'}
                            </button>
                          </div>
                        )}
                      {artifacts.map((art) => (
                        <div key={art.id} className="rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-text-secondary">
                              {ARTIFACT_LABEL[art.type] ?? art.type}
                            </p>
                            <div className="flex items-center gap-2">
                              {art.type === 'lesson_summary' &&
                                parseSelfTestQuestions(art.content).length > 0 && (
                                  <button
                                    onClick={() => {
                                      setSelfTestQuestions(parseSelfTestQuestions(art.content))
                                      setSelfTestOpen(true)
                                    }}
                                    className="text-xs text-accent-hover hover:underline"
                                  >
                                    🎯 自测
                                  </button>
                                )}
                              <button
                                onClick={() => void handleExportArtifactPdf(selected, art.content)}
                                className="text-xs text-text-muted hover:text-accent-hover"
                                title="导出为 PDF"
                              >
                                📄
                              </button>
                              <button
                                onClick={() => handleStartArtifactEdit(art)}
                                className="text-xs text-text-muted hover:text-text-secondary"
                                title="编辑产物内容"
                              >
                                ✏️
                              </button>
                            </div>
                          </div>
                          {editingArtifact?.artifactId === art.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={editArtifactText}
                                onChange={(e) => setEditArtifactText(e.target.value)}
                                rows={6}
                                className="w-full resize-none rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-xs text-text-primary focus:border-accent-border focus:outline-none"
                              />
                              <div className="flex gap-2">
                                <button onClick={() => void handleSaveArtifact()} className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover">保存</button>
                                <button onClick={() => setEditingArtifact(null)} className="text-xs text-text-muted hover:text-text-secondary">取消</button>
                              </div>
                            </div>
                          ) : (
                            <div className="markdown-body max-h-48 overflow-auto text-xs text-text-secondary" onCopy={handleCopyMathSource}>
                              <Suspense fallback={null}>
                                <MarkdownRenderer>
                                  {normalizeMathDelimiters(art.content)}
                                </MarkdownRenderer>
                              </Suspense>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 对话记录 */}
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-text-primary">对话记录</h3>
                    {msgs.length === 0 ? (
                      <p className="text-sm text-text-muted">暂无消息记录</p>
                    ) : (
                      <div className="space-y-2">
                        {msgs.map((msg) => (
                          <div key={msg.id} className={`rounded-lg px-3 py-2 text-sm ${
                            msg.role === 'user'
                              ? 'ml-8 bg-accent-subtle'
                              : msg.role === 'assistant'
                                ? 'mr-8 bg-bg-elevated'
                                : 'bg-bg-surface text-text-muted'
                          }`}>
                            <p className="mb-1 text-xs text-text-muted">
                              {msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : '系统'} · {new Date(msg.createdAt).toLocaleTimeString()}
                            </p>
                            <div className={msg.role === 'user' ? 'whitespace-pre-wrap text-text-secondary' : 'markdown-body text-text-secondary'} onCopy={handleCopyMathSource}>
                              <Suspense fallback={null}>
                                <MarkdownRenderer>
                                  {normalizeMathDelimiters(msg.content)}
                                </MarkdownRenderer>
                              </Suspense>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </main>

      {selfTestOpen && selfTestQuestions.length > 0 && (
        <SelfTestModal
          questions={selfTestQuestions}
          onClose={() => setSelfTestOpen(false)}
        />
      )}
    </div>
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
