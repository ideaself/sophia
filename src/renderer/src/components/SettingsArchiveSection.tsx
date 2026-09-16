import { useCallback, useEffect, useState } from 'react'
import { CollapsibleSection } from './CollapsibleSection'

interface ArchiveItem {
  id: string
  kind: string
  label: string
  movedAt: string
}

const ARCHIVE_KIND_LABEL: Record<string, string> = {
  conversation: '课堂',
  textbook: '教材',
  companion: '伙伴',
  other: '其他'
}

/**
 * 历史归档（回收站，拆分自 SettingsView）：恢复 / 永久删除已归档的数据。
 */
export function SettingsArchiveSection(): React.ReactElement {
  const [archiveItems, setArchiveItems] = useState<ArchiveItem[]>([])
  const [archiveMsg, setArchiveMsg] = useState<string | null>(null)
  const [purgeConfirmId, setPurgeConfirmId] = useState<string | null>(null)

  const loadArchive = useCallback(async () => {
    try {
      const items = await window.sophia.data.archive.list()
      setArchiveItems(items)
    } catch {
      setArchiveItems([])
    }
  }, [])

  useEffect(() => {
    void loadArchive()
  }, [loadArchive])

  const handleRestoreArchive = async (id: string) => {
    const result = await window.sophia.data.archive.restore(id)
    setArchiveMsg(result.success ? '已恢复到原位置' : '恢复失败，可能原位置已存在同名数据')
    await loadArchive()
  }

  const handlePurgeArchive = async (id: string) => {
    const result = await window.sophia.data.archive.purge(id)
    setArchiveMsg(result.success ? '已永久删除' : '删除失败')
    setPurgeConfirmId(null)
    await loadArchive()
  }

  return (
    <>
      <CollapsibleSection title="历史归档（回收站）" badge={archiveItems.length > 0 ? `${archiveItems.length} 项` : undefined}>
        <p className="mb-3 text-xs text-text-muted">
          删除课堂、教材或伙伴时，数据会先移入此处，可随时恢复或彻底删除。
        </p>
        {archiveMsg && <p className="mb-2 text-xs text-green-400">{archiveMsg}</p>}
        {archiveItems.length === 0 ? (
          <p className="rounded-lg border border-dashed border-surface-border px-4 py-6 text-center text-sm text-text-muted">
            暂无归档内容
          </p>
        ) : (
          <ul className="space-y-2">
            {archiveItems.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border bg-bg-surface px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">
                    <span className="mr-2 rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-text-muted">
                      {ARCHIVE_KIND_LABEL[item.kind] ?? item.kind}
                    </span>
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    归档于 {new Date(item.movedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleRestoreArchive(item.id)}
                    className="rounded border border-accent px-3 py-1 text-xs text-accent-hover hover:bg-accent-subtle"
                  >
                    恢复
                  </button>
                  {purgeConfirmId === item.id ? (
                    <>
                      <button
                        onClick={() => void handlePurgeArchive(item.id)}
                        className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-500"
                      >
                        确认删除
                      </button>
                      <button
                        onClick={() => setPurgeConfirmId(null)}
                        className="rounded border border-surface-border-strong px-3 py-1 text-xs text-text-muted hover:bg-bg-elevated"
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setPurgeConfirmId(item.id)}
                      className="rounded border border-surface-border-strong px-3 py-1 text-xs text-red-400 hover:bg-red-900/30"
                    >
                      永久删除
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>
    </>
  )
}
