import { useState } from 'react'

/**
 * 数据备份设置（拆分自 SettingsView）：导出全部数据 / 从备份恢复 / 打开数据目录。
 */
export function SettingsBackupSection(): React.ReactElement {
  const [backingUp, setBackingUp] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null)

  const handleExportBackup = async () => {
    setBackingUp(true)
    setBackupMsg(null)
    try {
      const result = await window.sophia.dialog.saveFile({
        defaultPath: `sophia-backup-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: 'ZIP 备份', extensions: ['zip'] }]
      })
      if (result.canceled || !result.filePath) return
      const backup = await window.sophia.data.exportBackup(result.filePath)
      setBackupMsg(`备份完成，共 ${backup.fileCount} 个文件`)
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : '备份失败')
    } finally {
      setBackingUp(false)
    }
  }

  const handleRestoreBackup = async () => {
    setRestoreMsg(null)
    const ok = await window.sophia.dialog.confirm({
      message: '从备份恢复会用备份数据替换当前全部学习数据。恢复前会自动先为当前数据做一份保险备份。确定继续吗？',
      confirmLabel: '恢复',
      cancelLabel: '取消'
    })
    if (!ok) return
    const result = await window.sophia.dialog.openFile({
      filters: [{ name: 'ZIP 备份', extensions: ['zip'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return
    setRestoring(true)
    try {
      const res = await window.sophia.data.restoreBackup(result.filePaths[0])
      if (res.success) {
        setRestoreMsg('恢复成功。界面将刷新以加载恢复后的数据…')
        /* v8 ignore next -- @preserve */
        setTimeout(() => window.location.reload(), 1500)
      } else {
        setRestoreMsg(`恢复失败：${res.error ?? '未知错误'}`)
      }
    } catch (err) {
      setRestoreMsg(`恢复失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setRestoring(false)
    }
  }

  const handleOpenDataDir = async () => {
    const res = await window.sophia.app.openDataDir()
    if (!res.success) setRestoreMsg(`无法打开数据目录：${res.error ?? '未知错误'}`)
  }

  return (
    <>
      <div className="mb-8">
        <h3 className="mb-3 text-lg font-semibold">数据备份</h3>
        <div className="rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
          <p className="text-sm text-text-secondary">
            将全部学习数据（对话、产物、教材、闪卡复习状态等）打包为一个 zip 文件，用于本地备份。
          </p>
          <p className="mt-2 text-xs text-text-muted">
            应用每次启动时会自动检查备份：每 7 天自动备份一次，保留最近 5 份（位于用户数据目录的 Sophia-backups 文件夹）。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void handleExportBackup()}
              disabled={backingUp}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {backingUp ? '备份中...' : '导出全部数据备份'}
            </button>
            <button
              onClick={() => void handleRestoreBackup()}
              disabled={restoring}
              className="rounded border border-red-800 px-4 py-2 text-sm text-red-400 hover:bg-red-900/30 disabled:opacity-50"
            >
              {restoring ? '恢复中...' : '从备份恢复'}
            </button>
            <button
              onClick={() => void handleOpenDataDir()}
              className="rounded border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated"
            >
              打开数据目录
            </button>
            {backupMsg && <span className="text-xs text-text-muted">{backupMsg}</span>}
            {restoreMsg && <span className="text-xs text-text-muted">{restoreMsg}</span>}
          </div>
        </div>
      </div>
    </>
  )
}
