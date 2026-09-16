import { useId, useState } from 'react'

interface CollapsibleSectionProps {
  title: string
  /** 标题右侧的辅助信息（如数量）。 */
  badge?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

/** 设置页区块：多条目时默认收起，点击标题展开/收起，避免页面过长。 */
export function CollapsibleSection({ title, badge, defaultOpen = false, children }: CollapsibleSectionProps): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <div className="mb-8">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-bg-elevated"
      >
        <span aria-hidden="true" className={`text-xs text-text-muted transition-transform duration-150 ${open ? '' : '-rotate-90'}`}>▾</span>
        <h3 className="text-lg font-semibold">{title}</h3>
        {badge && <span className="text-xs text-text-muted">{badge}</span>}
        <span className="ml-auto text-[10px] text-text-muted">{open ? '收起' : '展开'}</span>
      </button>
      {open && <div id={contentId} className="mt-3">{children}</div>}
    </div>
  )
}
