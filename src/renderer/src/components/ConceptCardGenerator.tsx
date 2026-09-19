/**
 * 复盘页「薄弱概念 → 记忆卡片」入口：
 * 展示本课待复习的薄弱概念数量，一键调主进程生成卡片并追加到本课卡片产物，
 * 生成后可直接跳到卡片复习（scoped）。
 */
import { useState } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { selectWeakConcepts } from '../../../shared/concept-mastery'

interface ConceptLike {
  name: string
  mastery: number
  misconception: string | null
}

interface ConceptCardGeneratorProps {
  conversationId: string
  conversationTitle: string
  concepts: ConceptLike[]
  /** 生成成功后通知父级刷新产物（让「记忆卡片」tab 出现）。 */
  onGenerated: () => void
}

export function ConceptCardGenerator({
  conversationId,
  conversationTitle,
  concepts,
  onGenerated
}: ConceptCardGeneratorProps): React.ReactElement | null {
  const setView = useAppStore((s) => s.setView)
  const setFlashcardScope = useAppStore((s) => s.setFlashcardScope)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const weak = selectWeakConcepts(concepts)
  if (weak.length === 0) return null

  const handleGenerate = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      const res = await window.sophia.data.generateConceptCards(conversationId)
      if (res.success) {
        setResult({
          ok: true,
          text:
            res.added > 0
              ? `已生成 ${res.added} 张卡片：${(res.concepts ?? []).join('、')}`
              : '暂无需要生成卡片的薄弱概念'
        })
        onGenerated()
      } else {
        setResult({ ok: false, text: res.error ?? '生成失败，请重试' })
      }
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : '生成失败，请重试' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-surface-border bg-bg-surface p-4">
      <p className="text-sm text-text-secondary">
        有 {weak.length} 个薄弱概念可以做成复习卡片（{weak.map((c) => c.name).join('、')}）
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void handleGenerate()}
          disabled={busy}
          className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? '生成中...' : '🃏 生成薄弱概念卡片'}
        </button>
        {result?.ok && (
          <button
            onClick={() => {
              setFlashcardScope({ conversationId, title: conversationTitle })
              setView('flashcards')
            }}
            className="rounded border border-surface-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated"
          >
            去复习
          </button>
        )}
      </div>
      {result && (
        <p className={`mt-2 text-xs ${result.ok ? 'text-green-500' : 'text-red-400'}`}>
          {result.text}
        </p>
      )}
    </div>
  )
}
