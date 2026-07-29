import { useState, useEffect } from 'react'
import { useTextbookStore } from '../stores/useTextbookStore'
import { useConversationStore } from '../stores/useConversationStore'

export function WebDavSyncView(): React.ReactElement {
  const [url, setUrl] = useState(() => localStorage.getItem('webdav-url') || '')
  const [username, setUsername] = useState(() => localStorage.getItem('webdav-username') || '')
  const [password, setPassword] = useState('')
  const [hasPassword, setHasPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [lastPush, setLastPush] = useState(() => localStorage.getItem('webdav-last-push') || '')
  const [lastPull, setLastPull] = useState(() => localStorage.getItem('webdav-last-pull') || '')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)

  const fetchTextbooks = useTextbookStore((s) => s.fetch)
  const fetchConversations = useConversationStore((s) => s.fetchActive)

  useEffect(() => {
    localStorage.removeItem('webdav-password')
    window.sophia.sync.hasWebdavPassword().then(setHasPassword)
    return window.sophia.sync.onProgress(setProgress)
  }, [])

  const getConfig = () => ({ url: url.trim(), username: username.trim() })

  const saveToStorage = async () => {
    localStorage.setItem('webdav-url', url.trim())
    localStorage.setItem('webdav-username', username.trim())
    if (password.length > 0) {
      await window.sophia.sync.setWebdavPassword(password)
      setHasPassword(true)
      setPassword('')
    }
  }

  const handleTest = async () => {
    await saveToStorage()
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.sophia.sync.test(getConfig())
      setTestResult({ ok: res.success, msg: res.message || 'Unknown result' })
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setTesting(false)
    }
  }

  const handlePush = async () => {
    await saveToStorage()
    try {
      const plan = await window.sophia.sync.planPush(getConfig())
      if (plan.deleteCount > 0) {
        const sample = plan.deleteSample.slice(0, 10).join('\n')
        const more = plan.deleteCount > 10 ? `\n... and ${plan.deleteCount - 10} more` : ''
        if (!await window.sophia.dialog.confirm({ message: `Push will DELETE ${plan.deleteCount} remote file(s) that no longer exist locally:\n${sample}${more}\n\nContinue?`, confirmLabel: 'Push' })) {
          return
        }
      }
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Push planning failed' })
      return
    }
    setPushing(true)
    setResult(null)
    setProgress(null)
    try {
      const res = await window.sophia.sync.push(getConfig())
      if (res.success) {
        setResult({ ok: true, msg: `Pushed ${res.transferred}, skipped ${res.skipped}, deleted ${res.deleted}` })
        if (res.timestamp) {
          setLastPush(res.timestamp)
          localStorage.setItem('webdav-last-push', res.timestamp)
        }
      } else {
        setResult({ ok: false, msg: `Pushed ${res.transferred}, skipped ${res.skipped}, deleted ${res.deleted}, ${res.errors.length} errors: ${res.errors[0]}` })
      }
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Push failed' })
    } finally {
      setPushing(false)
      setProgress(null)
    }
  }

  const handlePull = async () => {
    await saveToStorage()
    if (lastPush) {
      const ago = Date.now() - new Date(lastPush).getTime()
      const hours = Math.floor(ago / 3600000)
      if (!await window.sophia.dialog.confirm({ message: `Local data may have been modified since last push (${hours > 0 ? hours + 'h' : '<1h'} ago). Pull will overwrite local data. Continue?`, confirmLabel: 'Pull' })) {
        return
      }
    }
    try {
      const plan = await window.sophia.sync.planPull(getConfig())
      if (plan.deleteCount > 0) {
        const sample = plan.deleteSample.slice(0, 10).join('\n')
        const more = plan.deleteCount > 10 ? `\n... and ${plan.deleteCount - 10} more` : ''
        if (!await window.sophia.dialog.confirm({ message: `Pull will DELETE ${plan.deleteCount} local file(s) that no longer exist on the server:\n${sample}${more}\n\nContinue?`, confirmLabel: 'Pull' })) {
          return
        }
      }
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Pull planning failed' })
      return
    }
    setPulling(true)
    setResult(null)
    setProgress(null)
    try {
      const res = await window.sophia.sync.pull(getConfig())
      if (res.success) {
        setResult({ ok: true, msg: `Pulled ${res.transferred}, skipped ${res.skipped}, deleted ${res.deleted}` })
      } else {
        setResult({ ok: false, msg: `Pulled ${res.transferred}, skipped ${res.skipped}, deleted ${res.deleted}, ${res.errors.length} errors: ${res.errors[0]}` })
      }
      if (res.timestamp) {
        setLastPull(res.timestamp)
        localStorage.setItem('webdav-last-pull', res.timestamp)
      }
      fetchTextbooks()
      fetchConversations()
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Pull failed' })
    } finally {
      setPulling(false)
      setProgress(null)
    }
  }

  return (
    <div className="rounded-lg border border-surface-border bg-bg-surface p-6">
      <h3 className="mb-4 text-lg font-semibold text-text-primary">WebDAV Sync</h3>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Server URL</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://dav.example.com"
            className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-border focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-border focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? 'Saved — type to replace' : 'Not set'}
              className="w-full rounded border border-surface-border-strong bg-bg-deep px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-border focus:outline-none"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleTest}
            disabled={testing || !url.trim()}
            className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {testResult && (
          <p className={`text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.ok ? 'OK: ' : 'Error: '}{testResult.msg}
          </p>
        )}

        <div className="border-t border-surface-border pt-3">
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={handlePush}
              disabled={pushing || !url.trim()}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {pushing ? 'Pushing...' : 'Push (Upload)'}
            </button>
            <button
              onClick={handlePull}
              disabled={pulling || !url.trim()}
              className="rounded border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated disabled:opacity-50"
            >
              {pulling ? 'Pulling...' : 'Pull (Download)'}
            </button>
          </div>

          {(pushing || pulling) && progress && progress.total > 0 && (
            <div className="mb-2">
              <div className="h-1.5 w-full overflow-hidden rounded bg-bg-deep">
                <div
                  className="h-full bg-accent transition-all duration-200"
                  style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                />
              </div>
              <p className="mt-1 truncate text-xs text-text-muted">
                {progress.current}/{progress.total} — {progress.file}
              </p>
            </div>
          )}

          <div className="text-xs text-text-muted">
            <p>Last push: {lastPush ? new Date(lastPush).toLocaleString() : 'never'}</p>
            <p>Last pull: {lastPull ? new Date(lastPull).toLocaleString() : 'never'}</p>
          </div>
        </div>

        {result && (
          <p className={`text-xs ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
            {result.ok ? 'OK: ' : 'Error: '}{result.msg}
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-text-muted">
        Password is stored encrypted via the OS keychain and never synced. API keys are never synced.
      </p>
    </div>
  )
}
