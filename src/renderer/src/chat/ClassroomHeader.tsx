/**
 * Classroom header (extracted from ClassroomView): companion identity, lesson
 * title editing, pace / mode / reader toggles, screenshot, streaming status,
 * daily-goal ring and the end-class action.
 */

export interface ClassroomHeaderProps {
  companionName: string
  companionIdentity: string
  conversationId: string | null
  title: string
  editingTitle: boolean
  titleInput: string
  pace: 'slow' | 'normal' | 'fast'
  classMode: 'standard' | 'feynman'
  textbookTitle?: string | null
  hasTextbookOriginal: boolean
  readerOpen: boolean
  isStreaming: boolean
  isReasoning: boolean
  dailyGoal: number
  todayMinutes: number
  endingClass: boolean
  onRename: () => void
  onTitleInputChange: (value: string) => void
  onSaveTitle: () => void
  onCancelEditTitle: () => void
  onPaceChange: (pace: 'slow' | 'normal' | 'fast') => void
  onToggleFeynman: () => void
  onToggleReader: () => void
  onScreenshot: () => void
  onEndClass: () => void
}

export function ClassroomHeader({
  companionName,
  companionIdentity,
  conversationId,
  title,
  editingTitle,
  titleInput,
  pace,
  classMode,
  textbookTitle,
  hasTextbookOriginal,
  readerOpen,
  isStreaming,
  isReasoning,
  dailyGoal,
  todayMinutes,
  endingClass,
  onRename,
  onTitleInputChange,
  onSaveTitle,
  onCancelEditTitle,
  onPaceChange,
  onToggleFeynman,
  onToggleReader,
  onScreenshot,
  onEndClass
}: ClassroomHeaderProps): React.ReactElement {
  return (
    <div className="border-b border-surface-border bg-bg-surface px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <h2 className="font-semibold truncate">{companionName}</h2>
            <p className="text-xs text-text-muted truncate">{companionIdentity}</p>
          </div>
          {conversationId && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-text-muted text-xs">|</span>
              {editingTitle ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={titleInput}
                    onChange={(e) => onTitleInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSaveTitle()
                      if (e.key === 'Escape') onCancelEditTitle()
                    }}
                    onBlur={onSaveTitle}
                    className="w-40 rounded border border-accent-border bg-bg-deep px-2 py-0.5 text-xs text-text-primary focus:outline-none"
                    autoFocus
                  />
                </div>
              ) : (
                <button
                  onClick={onRename}
                  className="text-xs text-text-muted hover:text-text-secondary truncate max-w-[200px]"
                  title="点击重命名"
                >
                  {title} ✏️
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div
            className="flex overflow-hidden rounded-full border border-surface-border-strong text-xs"
            title="教学节奏：慢速不跳过独立知识点；快速略过已掌握内容"
          >
            {(['slow', 'normal', 'fast'] as const).map((p) => (
              <button
                key={p}
                onClick={() => onPaceChange(p)}
                className={`px-2 py-1 transition-colors ${
                  pace === p
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
                }`}
              >
                {p === 'slow' ? '慢' : p === 'normal' ? '标准' : '快'}
              </button>
            ))}
          </div>
          <button
            onClick={onToggleFeynman}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              classMode === 'feynman'
                ? 'border-accent text-accent hover:bg-accent-subtle'
                : 'border-surface-border-strong text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
            }`}
            title="切换课堂模式：标准苏格拉底课堂 / 费曼回讲（学习者向学徒讲解，检验理解）"
          >
            {classMode === 'feynman' ? '🗣 费曼回讲' : '🎓 标准课堂'}
          </button>
          {hasTextbookOriginal && (
            <button
              onClick={onToggleReader}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                readerOpen
                  ? 'border-accent text-accent hover:bg-accent-subtle'
                  : 'border-surface-border-strong text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
              }`}
              title="并排打开教材阅读（拖动分隔条调整宽度）"
            >
              📖 {readerOpen ? '关闭阅读' : '教材阅读'}
            </button>
          )}
          <button
            onClick={onScreenshot}
            className="rounded-full border border-surface-border-strong px-3 py-1 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
            title="截图当前课堂窗口并保存为图片"
          >
            📷 截图
          </button>
          {textbookTitle && (
            <span className="rounded-full bg-bg-elevated px-3 py-1 text-xs">
              📖 {textbookTitle}
            </span>
          )}
          {isStreaming && (
            <span className="text-xs text-accent animate-pulse">
              {isReasoning ? '正在推理…' : '正在组织回答…'}
            </span>
          )}
          {dailyGoal > 0 && (
            <div
              className="flex items-center gap-1.5"
              title={`今日已学习 ${todayMinutes}/${dailyGoal} 分钟`}
            >
              <svg width="26" height="26" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--bg-elevated)" strokeWidth="4" />
                <circle
                  cx="18" cy="18" r="15.5" fill="none" stroke="var(--accent)" strokeWidth="4"
                  strokeLinecap="round" pathLength={100}
                  strokeDasharray={`${Math.min(100, Math.round((todayMinutes / dailyGoal) * 100))} 100`}
                  transform="rotate(-90 18 18)"
                />
              </svg>
              <span className="text-xs tabular-nums text-text-muted">{todayMinutes}/{dailyGoal}m</span>
            </div>
          )}
          {conversationId && (
            <button
              onClick={onEndClass}
              disabled={endingClass}
              className="rounded border border-amber-700/60 px-3 py-1 text-xs text-amber-700 hover:bg-amber-900/30 disabled:opacity-50"
            >
              {endingClass ? '处理中...' : '下课'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
