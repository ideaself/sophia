// @vitest-environment jsdom
/**
 * NewClassroomModal — two-step picker (companion → textbook) with dialog
 * semantics and Escape/backdrop cancellation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { NewClassroomModal } from '../../../src/renderer/src/components/NewClassroomModal'
import { useCompanionStore } from '../../../src/renderer/src/stores/useCompanionStore'
import { useTextbookStore } from '../../../src/renderer/src/stores/useTextbookStore'
import type { Companion, Textbook } from '../../../src/renderer/src/types/models'

const LANDAU: Companion = { id: 'comp_landau', name: '朗道', identity: '化学导师', personalityKeywords: ['好奇'] }
const ZU: Companion = { id: 'comp_zu_chongzhi', name: '祖冲之', identity: '法医顾问', personalityKeywords: ['严谨'] }
const PHYSICS: Textbook = { id: 'tb_1', title: '费曼物理学', format: 'pdf', originalFile: 'physics.pdf' }

beforeEach(() => {
  useCompanionStore.setState({ companions: [LANDAU, ZU] })
  useTextbookStore.setState({ textbooks: [PHYSICS] })
})

afterEach(() => {
  cleanup()
})

function renderModal(overrides: { initialCompanion?: Companion | null } = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <NewClassroomModal
      initialCompanion={overrides.initialCompanion ?? null}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
  return { onConfirm, onCancel }
}

describe('NewClassroomModal', () => {
  it('starts with companion selection and lists the store companions', () => {
    renderModal()
    expect(screen.getByText('新建课堂 · 选择学习伙伴')).toBeTruthy()
    expect(screen.getByText('朗道')).toBeTruthy()
    expect(screen.getByText('祖冲之')).toBeTruthy()
  })

  it('advances to the textbook step after picking a companion', () => {
    renderModal()
    fireEvent.click(screen.getByText('朗道'))
    expect(screen.getByText(/选择教材（朗道）/)).toBeTruthy()
    expect(screen.getByText('费曼物理学')).toBeTruthy()
  })

  it('confirms with the picked companion and textbook', () => {
    const { onConfirm } = renderModal()
    fireEvent.click(screen.getByText('祖冲之'))
    fireEvent.click(screen.getByText('费曼物理学'))
    expect(onConfirm).toHaveBeenCalledWith(ZU, PHYSICS)
  })

  it('supports folder-free "no textbook" classrooms', () => {
    const { onConfirm } = renderModal()
    fireEvent.click(screen.getByText('朗道'))
    fireEvent.click(screen.getByText('不使用教材（自由对话）'))
    expect(onConfirm).toHaveBeenCalledWith(LANDAU, null)
  })

  it('skips straight to textbook selection when a companion is preselected', () => {
    renderModal({ initialCompanion: LANDAU })
    expect(screen.getByText(/选择教材（朗道）/)).toBeTruthy()
  })

  it('can go back to re-pick the companion', () => {
    renderModal()
    fireEvent.click(screen.getByText('朗道'))
    fireEvent.click(screen.getByText('← 重新选择角色'))
    expect(screen.getByText('新建课堂 · 选择学习伙伴')).toBeTruthy()
  })

  it('cancels via Escape and via the close button', () => {
    const { onCancel } = renderModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('取消'))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('exposes dialog semantics', () => {
    renderModal()
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })
})
