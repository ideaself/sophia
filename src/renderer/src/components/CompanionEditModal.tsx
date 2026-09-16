import { useEffect, useState } from 'react'

export function CompanionEditModal({
  companion,
  isCreating,
  onSave,
  onDelete,
  onClose
}: {
  companion: CompanionDTO | null
  isCreating: boolean
  onSave: (form: {
    name: string
    gender: string
    age: number
    identity: string
    personalityKeywords: string[]
    personality: string
    speakingStyle: string
    emotionalExpressions: string
  }) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}): React.ReactElement {
  const [form, setForm] = useState({
    name: companion?.name ?? '',
    gender: companion?.gender ?? 'female',
    age: companion?.age ?? 20,
    identity: companion?.identity ?? '',
    personalityKeywords: companion?.personalityKeywords.join(', ') ?? '',
    personality: companion?.personality ?? '',
    speakingStyle: companion?.speakingStyle ?? '',
    emotionalExpressions: companion?.emotionalExpressions ?? ''
  })
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  // Esc closes the dialog (parity with NewClassroomModal).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({
        name: form.name.trim(),
        gender: form.gender,
        age: form.age,
        identity: form.identity.trim(),
        personalityKeywords: form.personalityKeywords.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        personality: form.personality.trim(),
        speakingStyle: form.speakingStyle.trim(),
        emotionalExpressions: form.emotionalExpressions.trim()
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="companion-edit-title"
        className="flex w-[520px] flex-col rounded-lg border border-surface-border-strong bg-bg-deep shadow-xl max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
          <h3 id="companion-edit-title" className="text-lg font-semibold">
            {isCreating ? '添加自定义角色' : `编辑: ${companion?.name}`}
          </h3>
          <button onClick={onClose} aria-label="关闭"
            className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-secondary">x</button>
        </div>
        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          <div>
            <label htmlFor="companion-name" className="mb-1 block text-xs font-medium text-text-muted">名字</label>
            <input id="companion-name" type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="角色名称" autoFocus
              className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="companion-gender" className="mb-1 block text-xs font-medium text-text-muted">性别</label>
              <select id="companion-gender" value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none">
                <option value="male">男</option>
                <option value="female">女</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div>
              <label htmlFor="companion-age" className="mb-1 block text-xs font-medium text-text-muted">年龄</label>
              <input id="companion-age" type="number" value={form.age} onChange={(e) => setForm((f) => ({ ...f, age: parseInt(e.target.value) || 0 }))}
                className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
            </div>
          </div>
          <div>
            <label htmlFor="companion-identity" className="mb-1 block text-xs font-medium text-text-muted">身份</label>
            <input id="companion-identity" type="text" value={form.identity} onChange={(e) => setForm((f) => ({ ...f, identity: e.target.value }))}
              placeholder="如：苏格拉底式哲学导师"
              className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
          </div>
          <div>
            <label htmlFor="companion-keywords" className="mb-1 block text-xs font-medium text-text-muted">性格关键词 (逗号分隔)</label>
            <input id="companion-keywords" type="text" value={form.personalityKeywords} onChange={(e) => setForm((f) => ({ ...f, personalityKeywords: e.target.value }))}
              placeholder="如：温和, 耐心, 幽默"
              className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
          </div>
          <div>
            <label htmlFor="companion-personality" className="mb-1 block text-xs font-medium text-text-muted">性格描述</label>
            <textarea id="companion-personality" value={form.personality} onChange={(e) => setForm((f) => ({ ...f, personality: e.target.value }))}
              rows={3} placeholder="描述角色的性格特征..."
              className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
          </div>
          <div>
            <label htmlFor="companion-speaking" className="mb-1 block text-xs font-medium text-text-muted">说话风格</label>
            <textarea id="companion-speaking" value={form.speakingStyle} onChange={(e) => setForm((f) => ({ ...f, speakingStyle: e.target.value }))}
              rows={2} placeholder="描述角色的说话方式..."
              className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
          </div>
          <div>
            <label htmlFor="companion-emotions" className="mb-1 block text-xs font-medium text-text-muted">情感表达</label>
            <textarea id="companion-emotions" value={form.emotionalExpressions} onChange={(e) => setForm((f) => ({ ...f, emotionalExpressions: e.target.value }))}
              rows={2} placeholder="描述角色的情感表达方式..."
              className="w-full rounded border border-surface-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
          </div>
        </div>
        <div className="flex justify-between border-t border-surface-border px-6 py-4">
          <div>
            {!isCreating && onDelete && (
              deleteConfirm ? (
                <div className="flex gap-2">
                  <button onClick={onDelete}
                    className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-500">确认删除</button>
                  <button onClick={() => setDeleteConfirm(false)}
                    className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-muted hover:bg-bg-elevated">取消</button>
                </div>
              ) : (
                <button onClick={() => setDeleteConfirm(true)}
                  className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30">删除角色</button>
              )
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="rounded border border-surface-border-strong px-4 py-2 text-sm hover:bg-bg-elevated">取消</button>
            <button onClick={handleSave} disabled={saving || !form.name.trim() || !form.identity.trim()}
              className="rounded bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50">
              {saving ? '保存中...' : isCreating ? '创建' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
