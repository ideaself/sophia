import { useState } from 'react'
import { useCompanionStore } from '../stores/useCompanionStore'
import type { Companion } from '../types/models'

interface CompanionsManageViewProps {
  /** 「开始对话」：带着该角色打开新建课堂弹窗（继续选教材）。 */
  onStartConversation: (c: Companion) => void
}

export function CompanionsManageView({ onStartConversation }: CompanionsManageViewProps): React.ReactElement {
  const companions = useCompanionStore((s) => s.companions)
  const startEdit = useCompanionStore((s) => s.startEdit)
  const startCreate = useCompanionStore((s) => s.startCreate)
  const fetchCompanions = useCompanionStore((s) => s.fetch)

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    await window.sophia.companions.delete(id)
    setDeleteConfirmId(null)
    fetchCompanions()
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
              onClick={async () => {
                const full = await window.sophia.companions.get(c.id)
                if (full) startEdit(full)
              }}
              className="w-full text-left"
            >
              <h3 className="text-lg font-semibold">
                {c.name}
                {(c as { version?: number }).version != null && (
                  <span className="ml-2 align-middle rounded-full border border-surface-border-strong bg-bg-elevated px-1.5 py-0.5 text-[10px] font-normal text-text-muted">
                    v{(c as { version?: number }).version}
                  </span>
                )}
              </h3>
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
                onClick={() => onStartConversation(c)}
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
        onClick={startCreate}
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
