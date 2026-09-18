import { useCallback, useEffect, useState } from 'react'

/**
 * 档案锁设置（拆分自 SettingsView）：设置/关闭/立即锁定本地档案密码。
 */
export function SettingsLockSection(): React.ReactElement {
  const [lockEnabled, setLockEnabled] = useState(false)
  const [lockPin, setLockPin] = useState('')
  const [lockConfirmPin, setLockConfirmPin] = useState('')
  const [lockError, setLockError] = useState<string | null>(null)
  const [lockMsg, setLockMsg] = useState<string | null>(null)

  const loadLockStatus = useCallback(async () => {
    try {
      setLockEnabled(await window.sophia.data.lock.has())
    } catch {
      /* v8 ignore next -- @preserve */
      setLockEnabled(false)
    }
  }, [])

  useEffect(() => {
    void loadLockStatus()
  }, [loadLockStatus])

  const handleSetLock = async () => {
    setLockError(null)
    setLockMsg(null)
    if (lockPin.length < 4) {
      setLockError('密码至少 4 位')
      return
    }
    if (lockPin !== lockConfirmPin) {
      setLockError('两次输入的密码不一致')
      return
    }
    try {
      await window.sophia.data.lock.set(lockPin)
      setLockPin('')
      setLockConfirmPin('')
      setLockMsg('已启用档案锁，下次启动时需要解锁')
      await loadLockStatus()
    } catch (err) {
      /* v8 ignore next -- @preserve */
      setLockError(err instanceof Error ? err.message : '设置失败')
    }
  }

  const handleClearLock = async () => {
    setLockError(null)
    setLockMsg(null)
    await window.sophia.data.lock.clear()
    setLockMsg('已关闭档案锁')
    await loadLockStatus()
  }

  const handleRelock = () => {
    setLockMsg('已锁定')
    window.dispatchEvent(new Event('sophia:relock'))
  }

  return (
    <>
      <div className="mb-8">
        <h3 className="mb-3 text-lg font-semibold">档案锁</h3>
        <p className="mb-3 text-xs text-text-muted">
          给本地学习档案加一道密码，共用电脑时防止他人误入。密码使用系统加密保存。
        </p>
        {lockMsg && <p className="mb-2 text-xs text-green-400">{lockMsg}</p>}
        {lockError && <p className="mb-2 text-xs text-red-400">{lockError}</p>}
        {lockEnabled ? (
          <div className="rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
            <p className="text-sm text-text-secondary">
              档案锁已开启。
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleRelock}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                立即锁定
              </button>
              <button
                onClick={() => void handleClearLock()}
                className="rounded border border-surface-border-strong px-4 py-2 text-sm text-red-400 hover:bg-red-900/30"
              >
                关闭档案锁
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
            <div className="space-y-2">
              <input
                type="password"
                value={lockPin}
                onChange={(e) => setLockPin(e.target.value)}
                placeholder="设置解锁密码（至少 4 位）"
                className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
              />
              <input
                type="password"
                value={lockConfirmPin}
                onChange={(e) => setLockConfirmPin(e.target.value)}
                placeholder="再次输入确认"
                className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
              />
            </div>
            <button
              onClick={() => void handleSetLock()}
              disabled={!lockPin || !lockConfirmPin}
              className="mt-3 rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              启用档案锁
            </button>
          </div>
        )}
      </div>
    </>
  )
}
