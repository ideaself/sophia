/**
 * Keyboard shortcut cheat sheet (extracted from ClassroomView).
 * Escape closes it via the classroom-level key handler.
 */

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl + T', '新建标签页'],
  ['Ctrl + Shift + W', '关闭当前标签页'],
  ['Ctrl + Tab', '下一个标签页'],
  ['Ctrl + Shift + Tab', '上一个标签页'],
  ['Ctrl + F', '在当前对话中搜索'],
  ['Ctrl + /', '显示 / 隐藏快捷键'],
  ['Ctrl + Shift + A', 'AI 代答（示范回复）'],
  ['Alt + 1..9', '插入常用文本模板']
]

export function ShortcutSheet({ onClose }: { onClose: () => void }): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-sheet-title"
        className="w-80 rounded-xl border border-surface-border bg-bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="shortcut-sheet-title" className="mb-4 text-base font-semibold">键盘快捷键</h3>
        <div className="space-y-2.5 text-sm">
          {SHORTCUTS.map(([keys, desc]) => (
            <div key={keys} className="flex items-center justify-between gap-3">
              <kbd className="rounded border border-surface-border-strong bg-bg-elevated px-2 py-0.5 font-mono text-xs text-text-secondary">
                {keys}
              </kbd>
              <span className="text-xs text-text-muted">{desc}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded bg-accent py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          关闭 (Esc)
        </button>
      </div>
    </div>
  )
}
