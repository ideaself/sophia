/**
 * Classroom composer (extracted from ClassroomView): quick actions, math /
 * template popovers, AI-draft button, input textarea (with voice trigger
 * detection) and the send / stop button.
 *
 * All state stays with the parent — this component is presentational plus
 * the self-contained voice-trigger parsing.
 */

import type { RefObject } from 'react'
import { MathSymbolPanel } from './MathSymbolPanel'
import { TemplatePanel } from './TemplatePanel'
import { detectVoiceTrigger, loadVoiceTriggers } from '../../../shared/voice-trigger'

/** 课堂快捷操作（里程碑 2）：预置教学指令，点击直接发送。 */
const QUICK_ACTIONS: Array<{ label: string; prompt: string; title: string }> = [
  {
    label: '继续追问',
    prompt: '继续追问：请接着刚才的话题，再问一个更深的问题，检验我的理解。',
    title: '让导师继续提问'
  },
  {
    label: '给我提示',
    prompt: '给我一点提示，但不要直接给答案。请用引用块格式回复：> 💡 提示：<提示内容>',
    title: '请求一个提示（以提示卡片呈现）'
  },
  {
    label: '换种解释',
    prompt: '刚才讲得有点抽象，换个角度、用更直观的方式再解释一遍。',
    title: '换一种解释方式'
  },
  {
    label: '举个例子',
    prompt: '举个例子说明刚才的内容，越具体越好。',
    title: '请求一个具体例子'
  },
  {
    label: '考考我',
    prompt: '考考我：出 1-2 道题检验我是否掌握刚才的内容。格式要求：每道题用 **自测 N：<问题>** 开头，下面依次是 - 提示 1：、- 提示 2：、- 答案：，答案放最后。',
    title: '导师出题（会以测验卡片呈现）'
  },
  {
    label: '总结本节',
    prompt: '总结一下刚才讲的内容，列出核心要点。',
    title: '总结当前进度'
  },
  {
    label: '生成卡片',
    prompt: '把刚才讲的内容生成 3 张记忆卡片（格式：- 问题：…\n- 答案：…）。',
    title: '生成记忆卡片'
  },
  {
    label: '加入复习',
    prompt: '把刚才讲的核心概念加入我的复习计划，用引用块格式列出建议记忆的卡片：> 🧠 建议记忆：<问题> - <答案>，一卡一行。',
    title: '标记概念进入复习（以记忆卡片呈现）'
  }
]

export interface ClassroomComposerProps {
  input: string
  inputRef: RefObject<HTMLTextAreaElement | null>
  companionAvailable: boolean
  isStreaming: boolean
  sending: boolean
  aiAnswering: boolean
  mathOpen: boolean
  mathTab: string
  mathRef: RefObject<HTMLDivElement | null>
  templateOpen: boolean
  templateRef: RefObject<HTMLDivElement | null>
  onInputChange: (value: string) => void
  onRequestSend: () => void
  onCancel: () => void
  onAiAnswer: () => void
  onToggleMath: () => void
  onSelectMathTab: (id: string) => void
  onToggleTemplate: () => void
  onCloseTemplate: () => void
  onTemplateInsert: (template: string) => void
  onInsertText: (text: string) => void
  onQuickAction: (prompt: string) => void
}

export function ClassroomComposer({
  input,
  inputRef,
  companionAvailable,
  isStreaming,
  sending,
  aiAnswering,
  mathOpen,
  mathTab,
  mathRef,
  templateOpen,
  templateRef,
  onInputChange,
  onRequestSend,
  onCancel,
  onAiAnswer,
  onToggleMath,
  onSelectMathTab,
  onToggleTemplate,
  onCloseTemplate,
  onTemplateInsert,
  onInsertText,
  onQuickAction
}: ClassroomComposerProps): React.ReactElement {
  return (
    <div className="border-t border-surface-border bg-bg-surface p-4">
      {/* 快捷课堂操作（里程碑 2）：预置教学指令，一键发送 */}
      <div className="mb-2 flex flex-wrap gap-1">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            onClick={() => onQuickAction(a.prompt)}
            disabled={isStreaming || !companionAvailable}
            className="rounded-full border border-surface-border-strong px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:border-accent-border hover:text-accent-hover disabled:opacity-40"
            title={a.title}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div ref={mathRef} className="relative flex gap-3">
        {mathOpen && (
          <MathSymbolPanel tab={mathTab} onSelectTab={onSelectMathTab} onInsert={onInsertText} />
        )}
        <button
          onClick={onToggleMath}
          className={`rounded border px-3 py-2 text-sm transition-colors ${
            mathOpen
              ? 'border-accent text-accent'
              : 'border-surface-border-strong text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
          }`}
          title="插入数学符号 / 公式 (Σ)"
        >
          Σ
        </button>
        <div ref={templateRef} className="relative">
          {templateOpen && (
            <TemplatePanel
              onInsert={onTemplateInsert}
              onClose={onCloseTemplate}
            />
          )}
          <button
            onClick={onToggleTemplate}
            className={`rounded border px-3 py-2 text-sm transition-colors ${
              templateOpen
                ? 'border-accent text-accent'
                : 'border-surface-border-strong text-text-muted hover:bg-bg-elevated hover:text-text-secondary'
            }`}
            title="插入常用文本模板"
          >
            ☰
          </button>
        </div>
        <button
          onClick={onAiAnswer}
          disabled={aiAnswering || !companionAvailable}
          className="rounded border border-surface-border-strong px-3 py-2 text-sm text-text-muted hover:bg-bg-elevated hover:text-text-secondary disabled:opacity-50"
          title="AI 代答：让伙伴示范起草一段回复（Ctrl+Shift+A）"
        >
          {aiAnswering ? '起草中...' : 'AI 代答'}
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            const { action, stripped } = detectVoiceTrigger(e.target.value, loadVoiceTriggers())
            if (action === 'send') {
              onInputChange(stripped)
              if (stripped.trim()) onRequestSend()
            } else if (action === 'clear') {
              onInputChange('')
            } else {
              onInputChange(e.target.value)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              onRequestSend()
            }
          }}
          rows={1}
          placeholder="输入你的问题... (Enter 发送，Shift+Enter 换行)"
          className="flex-1 resize-none overflow-y-auto rounded border border-surface-border-strong bg-bg-deep px-4 py-2 text-sm leading-relaxed text-text-primary placeholder-gray-500 focus:border-accent-border focus:outline-none"
        />
        {isStreaming ? (
          <button
            onClick={onCancel}
            className="rounded border border-red-700 px-4 py-2 text-sm text-red-400 hover:bg-red-900/30"
          >
            停止
          </button>
        ) : (
          <button
            onClick={onRequestSend}
            disabled={!input.trim() || sending}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {sending ? '发送中...' : '发送'}
          </button>
        )}
      </div>
    </div>
  )
}
