/**
 * Classroom tab strip (extracted from ClassroomView).
 *
 * Presentational: selection, closing and creating tabs are delegated to the
 * parent so the tab state stays in one place. Keyboard-accessible tablist
 * semantics live here.
 */

interface ClassroomTabBarTab {
  id: string
  title: string
}

interface ClassroomTabBarProps {
  tabs: ClassroomTabBarTab[]
  activeIdx: number
  onSelect: (idx: number) => void
  onClose: (idx: number) => void
  onNew: () => void
}

export function ClassroomTabBar({
  tabs,
  activeIdx,
  onSelect,
  onClose,
  onNew
}: ClassroomTabBarProps): React.ReactElement {
  return (
    <div className="flex items-center border-b border-surface-border bg-bg-surface px-2 pt-1">
      <div className="flex-1 flex items-center overflow-x-auto gap-0.5" role="tablist" aria-label="课堂标签页">
        {tabs.map((tab, idx) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={idx === activeIdx}
            tabIndex={idx === activeIdx ? 0 : -1}
            onClick={() => onSelect(idx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(idx)
              }
            }}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-t cursor-pointer select-none whitespace-nowrap max-w-[160px] ${
              idx === activeIdx
                ? 'bg-bg-deep text-text-primary border border-b-0 border-surface-border -mb-px'
                : 'text-text-muted hover:text-text-secondary hover:bg-bg-elevated'
            }`}
          >
            <span className="truncate">{tab.title}</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); onClose(idx) }}
                className="flex-shrink-0 ml-1 w-4 h-4 flex items-center justify-center rounded hover:bg-red-900/30 hover:text-red-400"
                aria-label={`关闭标签 ${tab.title}`}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={onNew}
        className="flex-shrink-0 px-2 py-1.5 text-xs text-text-muted hover:text-text-secondary hover:bg-bg-elevated rounded"
        title="新建对话"
        aria-label="新建对话"
      >
        +
      </button>
    </div>
  )
}
