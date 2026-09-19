/**
 * Classroom message list (extracted from ClassroomView): the virtualized
 * scroll container with the empty state, message rows (思考过程 + ChatMessage),
 * the error row and the end-of-class card.
 *
 * Pure view: all state and scroll behaviour live in `useMessageListScroll`
 * and the parent view; this component only renders what it is given.
 */

import type { RefObject } from 'react'
import { ChatMessage, type MessageHighlight } from './ChatMessage'
import { ThinkingBlock } from '../components/ThinkingBlock'
import { ChatErrorRow } from './ChatErrorRow'
import { EndClassCard } from './EndClassCard'
import { type DisplayMessage, type TabState } from './types'
import type { MessageVirtualizer } from './useMessageListScroll'
import type { CitationMismatchMap } from './useCitationAudit'

export type MessageRow =
  | {
      kind: 'message'
      key: string
      msg: DisplayMessage
      showThinking: boolean
      highlight: MessageHighlight
    }
  | { kind: 'error'; key: string }
  | { kind: 'end'; key: string }

export interface MessageListProps {
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
  rows: MessageRow[]
  virtualizer: MessageVirtualizer
  companionName: string
  /** Number of real messages (without status rows) — rewind visibility. */
  messageCount: number
  isStreaming: boolean
  reasoningContent: string
  groundingFlagged: ReadonlySet<string>
  /** 消息 → 未在教材中找到的引用标记（运行时引用真实性校验）。 */
  citationMismatches: CitationMismatchMap
  errorMessage: string | undefined
  onRetry?: () => void
  textbookId: string | null
  endResult: TabState['endResult']
  redoing: boolean
  onRewind: (messageId: string) => void
  onEdit: (messageId: string, content: string) => Promise<void>
  onDelete: (messageId: string) => Promise<void>
  onRegenerate: (messageId: string) => Promise<void>
  onReviewNewCards: () => void
  onContinueLearning: () => void
  onRedoArtifacts: () => void
}

export function MessageList({
  scrollRef,
  onScroll,
  rows,
  virtualizer,
  companionName,
  messageCount,
  isStreaming,
  reasoningContent,
  groundingFlagged,
  citationMismatches,
  errorMessage,
  onRetry,
  textbookId,
  endResult,
  redoing,
  onRewind,
  onEdit,
  onDelete,
  onRegenerate,
  onReviewNewCards,
  onContinueLearning,
  onRedoArtifacts
}: MessageListProps): React.ReactElement {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="flex-1 overflow-auto p-6"
      role="log"
      aria-label="课堂消息"
    >
      {rows.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-center text-text-muted">
            开始和 <span className="text-text-secondary">{companionName}</span> 对话吧。
            <br />
            试着提出一个你想探讨的问题。
          </p>
        </div>
      ) : (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index]
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                className="pb-4"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`
                }}
              >
                {row.kind === 'message' && (
                  <>
                    {row.showThinking && (
                      <details className="mb-2 rounded border border-surface-border bg-bg-surface/60 px-3 py-2">
                        <summary className="cursor-pointer select-none text-xs text-text-muted hover:text-text-secondary">
                          🧠 思考过程 {isStreaming && <span className="text-accent animate-pulse">(进行中...)</span>}
                        </summary>
                        <ThinkingBlock content={reasoningContent} />
                      </details>
                    )}
                    <ChatMessage
                      id={row.msg.id}
                      role={row.msg.role}
                      content={row.msg.content}
                      createdAt={row.msg.createdAt}
                      showActions={!isStreaming && row.msg.role !== 'system'}
                      highlight={row.highlight}
                      textbookId={textbookId}
                      showGroundingNotice={groundingFlagged.has(row.msg.id)}
                      mismatchedCitations={citationMismatches.get(row.msg.id)}
                      onRewind={
                        !isStreaming &&
                        row.msg.role !== 'system' &&
                        vi.index < messageCount - 1
                          ? onRewind
                          : undefined
                      }
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onRegenerate={onRegenerate}
                    />
                  </>
                )}
                {row.kind === 'error' && (
                  <ChatErrorRow message={errorMessage} onRetry={onRetry} />
                )}
                {row.kind === 'end' && endResult && (
                  <EndClassCard
                    result={endResult}
                    redoing={redoing}
                    onReviewNewCards={onReviewNewCards}
                    onContinueLearning={onContinueLearning}
                    onRedoArtifacts={onRedoArtifacts}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
