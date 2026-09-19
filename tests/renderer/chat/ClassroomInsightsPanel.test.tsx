// @vitest-environment jsdom
/**
 * ClassroomInsightsPanel — live concept mastery panel: hints without a
 * conversation / concepts, tier summary and weak-first list rendering.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ClassroomInsightsPanel } from '../../../src/renderer/src/chat/ClassroomInsightsPanel'

afterEach(cleanup)

function concept(
  name: string,
  mastery: number,
  extra: Partial<ConceptStateDTO> = {}
): ConceptStateDTO {
  return {
    id: `k_${name}`,
    name,
    textbookId: null,
    mastery,
    misconception: null,
    attemptCount: 1,
    correctCount: 0,
    lastSeenAt: '2026-09-20T08:00:00.000Z',
    updatedAt: '2026-09-20T08:00:00.000Z',
    evidenceConversationId: 'conv_1',
    evidenceMessageIds: [],
    ...extra
  }
}

describe('ClassroomInsightsPanel', () => {
  it('hints before a conversation exists', () => {
    render(<ClassroomInsightsPanel conversationId={null} concepts={[]} />)
    expect(screen.getByText(/开始对话后/)).toBeTruthy()
  })

  it('hints while no concept has been recognized yet', () => {
    render(<ClassroomInsightsPanel conversationId="conv_1" concepts={[]} />)
    expect(screen.getByText(/尚未识别到概念/)).toBeTruthy()
  })

  it('summarizes tiers and lists concepts weak-first with misconceptions', () => {
    render(
      <ClassroomInsightsPanel
        conversationId="conv_1"
        concepts={[
          concept('熵', 0.2, { misconception: '熵是能量' }),
          concept('焓', 0.5),
          concept('自由能', 0.9)
        ]}
      />
    )

    expect(screen.getByText('已识别 3 个概念：薄弱 1 · 基本理解 1 · 已掌握 1')).toBeTruthy()
    expect(screen.getByText('薄弱 · 20%')).toBeTruthy()
    expect(screen.getByText('理解 · 50%')).toBeTruthy()
    expect(screen.getByText('掌握 · 90%')).toBeTruthy()
    expect(screen.getByText('⚠️ 误解点：熵是能量')).toBeTruthy()

    // 薄弱排在最前。
    const names = screen.getAllByText(/^(熵|焓|自由能)$/).map((el) => el.textContent)
    expect(names).toEqual(['熵', '焓', '自由能'])
  })
})
