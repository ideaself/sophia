import { useEffect, useState } from 'react'
import type { UpdaterCheckResult } from '../../../shared/updater'

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; result: UpdaterCheckResult }

/**
 * 关于区块（设置页）：应用版本 + 手动检查更新。
 *
 * 后台自动更新与「退出时安装」由主进程负责；这里只做用户主动触发的一次
 * 检查，给出版本可用的明确反馈（开发模式不联网检查）。
 */
export function SettingsAboutSection(): React.ReactElement {
  const [version, setVersion] = useState('')
  const [state, setState] = useState<CheckState>({ kind: 'idle' })

  useEffect(() => {
    void window.sophia.getVersion().then(setVersion).catch(() => {})
  }, [])

  const handleCheck = async () => {
    if (state.kind === 'checking') return
    setState({ kind: 'checking' })
    try {
      setState({ kind: 'done', result: await window.sophia.updater.checkForUpdates() })
    } catch (err) {
      setState({
        kind: 'done',
        result: { status: 'error', message: err instanceof Error ? err.message : '未知错误' }
      })
    }
  }

  const message = ((): { text: string; tone: string } | null => {
    if (state.kind !== 'done') return null
    const r = state.result
    switch (r.status) {
      case 'update-available':
        return {
          text: `发现新版本 v${r.version}，已开始后台下载，退出应用时自动安装。`,
          tone: 'text-green-400'
        }
      case 'up-to-date':
        return { text: '已是最新版本。', tone: 'text-green-400' }
      case 'disabled':
        return { text: '开发模式（未安装版）不检查更新。', tone: 'text-text-muted' }
      case 'error':
        return { text: `检查失败：${r.message}`, tone: 'text-red-400' }
    }
  })()

  return (
    <div className="mb-8">
      <h3 className="mb-3 text-lg font-semibold">关于</h3>
      <div className="rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
        <p className="text-sm text-text-secondary">Sophia v{version || '…'}</p>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => void handleCheck()}
            disabled={state.kind === 'checking'}
            className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-primary hover:bg-bg-elevated disabled:opacity-50"
          >
            检查更新
          </button>
          {state.kind === 'checking' && <span className="text-xs text-text-muted">检查中…</span>}
          {message && <span className={`text-xs ${message.tone}`}>{message.text}</span>}
        </div>
      </div>
    </div>
  )
}
