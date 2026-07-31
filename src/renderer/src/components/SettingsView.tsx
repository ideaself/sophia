import { useState, useEffect, useCallback } from 'react'
import { ThemeSwitcher } from './ThemeSwitcher'
import { WebDavSyncView } from './WebDavSyncView'

export function SettingsView(): React.ReactElement {
  const [providers, setProviders] = useState<ProviderDTO[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderDTO | null>(null)
  const [form, setForm] = useState({
    name: '',
    type: 'custom' as string,
    baseUrl: '',
    apiKey: '',
    models: [] as string[],
    selectedModel: ''
  })
  const [fetchingModels, setFetchingModels] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(
    () => localStorage.getItem('sophia.thinkingEnabled') === '1'
  )
  const [hideNarration, setHideNarration] = useState(
    () => localStorage.getItem('sophia.hideNarration') === '1'
  )
  const [backingUp, setBackingUp] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)

  const handleToggleThinking = (enabled: boolean) => {
    setThinkingEnabled(enabled)
    localStorage.setItem('sophia.thinkingEnabled', enabled ? '1' : '0')
  }

  const handleToggleHideNarration = (enabled: boolean) => {
    setHideNarration(enabled)
    localStorage.setItem('sophia.hideNarration', enabled ? '1' : '0')
  }

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

  const loadProviders = useCallback(async () => {
    const list = await window.sophia.providers.list()
    setProviders(list)
    const active = await window.sophia.providers.getActive()
    setActiveId(active?.id ?? null)
  }, [])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  const openAddModal = () => {
    setEditingProvider(null)
    setForm({ name: '', type: 'custom', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', models: [], selectedModel: '' })
    setTestResult(null)
    setModalOpen(true)
  }

  const openEditModal = async (p: ProviderDTO) => {
    setEditingProvider(p)
    setForm({
      name: p.name,
      type: p.type,
      baseUrl: p.baseUrl,
      apiKey: '',
      models: p.models,
      selectedModel: p.selectedModel
    })
    setTestResult(null)
    setModalOpen(true)
  }

  const handleFetchModels = async () => {
    setFetchingModels(true)
    setTestResult(null)
    try {
      const key = form.apiKey || '__skip__'
      const result = await window.sophia.providers.testConnection(form.baseUrl, key)
      if (result.success && result.models && result.models.length > 0) {
        setForm((f) => ({ ...f, models: result.models!, selectedModel: result.models![0] }))
        setTestResult({ ok: true, msg: `Found ${result.models.length} models` })
      } else {
        setTestResult({ ok: false, msg: result.error || result.message || 'No models found' })
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setFetchingModels(false)
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const key = form.apiKey || '__skip__'
      const result = await window.sophia.providers.testConnection(form.baseUrl, key)
      if (result.success) {
        setTestResult({ ok: true, msg: result.message || 'Connection successful' })
        if (result.models && result.models.length > 0) {
          setForm((f) => ({ ...f, models: result.models!, selectedModel: result.models![0] }))
        }
      } else {
        setTestResult({ ok: false, msg: result.error || 'Connection failed' })
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.baseUrl.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (editingProvider) {
        await window.sophia.providers.update(editingProvider.id, {
          name: form.name.trim(),
          type: form.type,
          baseUrl: form.baseUrl.trim(),
          models: form.models,
          selectedModel: form.selectedModel
        })
        if (form.apiKey) {
          await window.sophia.providers.setApiKey(editingProvider.id, form.apiKey)
        }
      } else {
        await window.sophia.providers.create({
          name: form.name.trim(),
          type: form.type,
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey,
          models: form.models,
          selectedModel: form.selectedModel
        })
      }
      setModalOpen(false)
      await loadProviders()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleSetActive = async (id: string) => {
    await window.sophia.providers.setActive(id)
    await loadProviders()
  }

  const handleDelete = async (id: string) => {
    await window.sophia.providers.delete(id)
    setDeleteConfirmId(null)
    await loadProviders()
  }

  const PRESET_URLS: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    mimo: 'https://api.mimo.com/v1',
    custom: ''
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h2 className="mb-6 text-2xl font-bold">设置</h2>

      <ThemeSwitcher />

      <WebDavSyncView />

      <div className="mb-8" />

      <div className="mb-8">
        <h3 className="mb-3 text-lg font-semibold">数据备份</h3>
        <div className="rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
          <p className="text-sm text-text-secondary">
            将全部学习数据（对话、产物、教材、闪卡复习状态等）打包为一个 zip 文件，用于本地备份。
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleExportBackup}
              disabled={backingUp}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {backingUp ? '备份中...' : '导出全部数据备份'}
            </button>
            {backupMsg && <span className="text-xs text-text-muted">{backupMsg}</span>}
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="mb-3 text-lg font-semibold">课堂行为</h3>
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
          <div className="pr-4">
            <p className="text-sm font-medium">课堂追问启用深度思考（Thinking）</p>
            <p className="mt-0.5 text-xs text-text-muted">让模型先推理再回答，质量更高但响应更慢；课后摘要、闪卡等生成不受影响</p>
          </div>
          <input
            type="checkbox"
            checked={thinkingEnabled}
            onChange={(e) => handleToggleThinking(e.target.checked)}
            className="h-4 w-4 flex-shrink-0"
          />
        </label>
        <label className="mt-2 flex cursor-pointer items-center justify-between rounded-lg border border-surface-border bg-bg-surface px-4 py-3">
          <div className="pr-4">
            <p className="text-sm font-medium">纯净对话（隐藏动作/表情旁白）</p>
            <p className="mt-0.5 text-xs text-text-muted">只显示对话正文与提问，伙伴不再输出 `*动作/表情*` 舞台说明</p>
          </div>
          <input
            type="checkbox"
            checked={hideNarration}
            onChange={(e) => handleToggleHideNarration(e.target.checked)}
            className="h-4 w-4 flex-shrink-0"
          />
        </label>
      </div>

      <h2 className="mb-6 text-2xl font-bold">模型服务设置</h2>

      {error && (
        <div className="mb-4 rounded border border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-3 mb-6">
        {providers.map((p) => (
          <div
            key={p.id}
            className={`rounded-lg border p-4 transition-colors ${
              p.isActive
                ? 'border-accent-border bg-accent-subtle'
                : 'border-surface-border bg-bg-surface'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium">{p.name}</h4>
                  {p.isActive && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-white">
                      当前
                    </span>
                  )}
                  <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-text-muted">
                    {p.type}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-muted truncate">{p.baseUrl}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  模型：{p.selectedModel || <span className="text-text-muted">未选择</span>}
                  {p.models.length > 0 && (
                    <span className="text-text-muted">（{p.models.length} 个可用）</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                {!p.isActive && (
                  <button
                    onClick={() => handleSetActive(p.id)}
                    className="rounded border border-accent px-3 py-1 text-xs text-accent-hover hover:bg-accent-subtle"
                  >
                    设为默认
                  </button>
                )}
                <button
                  onClick={() => openEditModal(p)}
                  className="rounded border border-surface-border-strong px-3 py-1 text-xs text-text-secondary hover:bg-bg-elevated"
                >
                  编辑
                </button>
                {deleteConfirmId === p.id ? (
                  <>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-500"
                    >
                      确认删除
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="rounded border border-surface-border-strong px-3 py-1 text-xs text-text-muted hover:bg-bg-elevated"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(p.id)}
                    className="rounded border border-surface-border-strong px-3 py-1 text-xs text-red-400 hover:bg-red-900/30"
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {providers.length === 0 && (
          <div className="rounded-lg border border-dashed border-surface-border p-8 text-center">
            <p className="text-text-muted mb-3">尚未配置模型服务</p>
            <p className="text-xs text-text-muted">添加一个模型服务即可开始使用 AI 课堂</p>
          </div>
        )}
      </div>

      <button
        onClick={openAddModal}
        className="rounded-lg border border-dashed border-surface-border-strong w-full px-4 py-3 text-sm text-text-muted hover:border-accent-border hover:text-accent-hover transition-colors"
      >
        + 添加模型服务
      </button>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex w-[520px] flex-col rounded-lg border border-surface-border-strong bg-bg-deep shadow-xl max-h-[85vh]">
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
              <h3 className="text-lg font-semibold">
                {editingProvider ? '编辑模型服务' : '添加模型服务'}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
              >
                x
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">名称</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="我的服务"
                  className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">类型</label>
                <div className="flex gap-2">
                  {(['deepseek', 'mimo', 'custom'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          type: t,
                          baseUrl: PRESET_URLS[t] || f.baseUrl
                        }))
                      }
                      className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                        form.type === t
                          ? 'bg-accent text-white'
                          : 'border border-surface-border-strong text-text-muted hover:bg-bg-elevated'
                      }`}
                    >
                      {t === 'deepseek' ? 'DeepSeek' : t === 'mimo' ? 'MiMo' : '自定义'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">接口地址</label>
                <input
                  type="text"
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  placeholder="https://api.deepseek.com/v1"
                  className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">
                  API Key {editingProvider && '（留空表示保持不变）'}
                </label>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder="sk-..."
                  className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-gray-600 focus:border-accent-border focus:outline-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleTestConnection}
                  disabled={testing || !form.baseUrl}
                  className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated disabled:opacity-50"
                >
                  {testing ? '测试中...' : '测试连接'}
                </button>
                <button
                  onClick={handleFetchModels}
                  disabled={fetchingModels || !form.baseUrl}
                  className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated disabled:opacity-50"
                >
                  {fetchingModels ? '获取中...' : '获取模型'}
                </button>
              </div>
              {testResult && (
                <p className={`text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {testResult.ok ? '成功：' : '错误：'}{testResult.msg}
                </p>
              )}

              {form.models.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-muted">
                    模型（{form.models.length} 个可用）
                  </label>
                  <select
                    value={form.selectedModel}
                    onChange={(e) => setForm((f) => ({ ...f, selectedModel: e.target.value }))}
                    className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none"
                  >
                    {form.models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}
              {form.models.length === 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-muted">
                    模型（手动输入）
                  </label>
                  <input
                    type="text"
                    value={form.selectedModel}
                    onChange={(e) => setForm((f) => ({ ...f, selectedModel: e.target.value }))}
                    placeholder="例如 deepseek-v4-pro"
                    className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-gray-600 focus:border-accent-border focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-surface-border px-6 py-4">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded border border-surface-border-strong px-4 py-2 text-sm hover:bg-bg-elevated"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.baseUrl.trim()}
                className="rounded bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {saving ? '保存中...' : editingProvider ? '更新' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-text-muted">
        API Key 使用系统加密保存在本地，绝不会上传或共享。
      </p>
    </div>
  )
}
