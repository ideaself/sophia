/**
 * Math symbol quick-insert panel (extracted from ClassroomView).
 * Pure presentational: the selected group is controlled by the parent.
 */

const MATH_SYMBOL_GROUPS: Array<{ id: string; label: string; items: string[] }> = [
  {
    id: 'greek',
    label: '希腊字母',
    items: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω', 'Γ', 'Δ', 'Θ', 'Λ', 'Ξ', 'Π', 'Σ', 'Φ', 'Ψ', 'Ω']
  },
  {
    id: 'ops',
    label: '运算符号',
    items: ['+', '−', '×', '÷', '±', '∓', '=', '≠', '≈', '<', '>', '≤', '≥', '∞', '∂', '∇', '∫', '∬', '∑', '∏', '√', '∛', '∜', '%', '‰']
  },
  {
    id: 'sets',
    label: '集合逻辑',
    items: ['∈', '∉', '⊂', '⊃', '⊆', '⊇', '∪', '∩', '∅', '∧', '∨', '¬', '→', '⇒', '↔', '⇔', '∀', '∃', '∴', '∵', '∥', '⊥']
  },
  {
    id: 'templates',
    label: '公式模板',
    items: ['\\frac{a}{b}', '\\sqrt{x}', 'x^{2}', 'x_{i}', '\\sum_{i=1}^{n}', '\\int_{a}^{b}', '\\lim_{x \\to 0}', '\\overrightarrow{AB}', '\\begin{cases} ... \\end{cases}']
  }
]

export function MathSymbolPanel({
  tab,
  onSelectTab,
  onInsert
}: {
  tab: string
  onSelectTab: (id: string) => void
  onInsert: (symbol: string) => void
}): React.ReactElement {
  const active = MATH_SYMBOL_GROUPS.find((g) => g.id === tab) ?? MATH_SYMBOL_GROUPS[0]
  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-80 rounded-lg border border-surface-border bg-bg-surface p-3 shadow-lg">
      <div className="mb-2 flex flex-wrap gap-1">
        {MATH_SYMBOL_GROUPS.map((g) => (
          <button
            key={g.id}
            onClick={() => onSelectTab(g.id)}
            className={`rounded px-2 py-0.5 text-xs transition-colors ${
              tab === g.id
                ? 'bg-accent text-white'
                : 'text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-1">
        {active.items.map((s) => (
          <button
            key={s}
            onClick={() => onInsert(s)}
            className="overflow-hidden rounded border border-surface-border-strong px-1 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated"
            title={s}
          >
            {s.length > 6 ? '模板' : s}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-text-muted">
        点击插入到输入框；用 $...$ 包裹即可渲染为公式
      </p>
    </div>
  )
}
