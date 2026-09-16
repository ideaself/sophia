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

const ALICE: Companion = { id: 'comp_alice', name: '爱丽丝', identity: '化学导师', personalityKeywords: ['好奇'] }
const HOLMES: Companion = { id: 'comp_holmes', name: '福尔摩斯', identity: '法医顾问', personalityKeywords: ['严谨'] }
const PHYSICS: Textbook = { id: 'tb_1', title: '费曼物理学', format: 'pdf', originalFile: 'physics.pdf' }

beforeEach(() => {
  useCompanionStore.setState({ companions: [ALICE, HOLMES] })
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
    expect(screen.getByText('爱丽丝')).toBeTruthy()
    expect(screen.getByText('福尔摩斯')).toBeTruthy()
  })

  it('advances to the textbook step after picking a companion', () => {
    renderModal()
    fireEvent.click(screen.getByText('爱丽丝'))
    expect(screen.getByText(/选择教材（爱丽丝）/)).toBeTruthy()
    expect(screen.getByText('费曼物理学')).toBeTruthy()
  })

  it('confirms with the picked companion and textbook', () => {
    const { onConfirm } = renderModal()
    fireEvent.click(screen.getByText('福尔摩斯'))
    fireEvent.click(screen.getByText('费曼物理学'))
    expect(onConfirm).toHaveBeenCalledWith(HOLMES, PHYSICS)
  })

  it('supports folder-free "no textbook" classrooms', () => {
    const { onConfirm } = renderModal()
    fireEvent.click(screen.getByText('爱丽丝'))
    fireEvent.click(screen.getByText('不使用教材（自由对话）'))
    expect(onConfirm).toHaveBeenCalledWith(ALICE, null)
  })

  it('skips straight to textbook selection when a companion is preselected', () => {
    renderModal({ initialCompanion: ALICE })
    expect(screen.getByText(/选择教材（爱丽丝）/)).toBeTruthy()
  })

  it('can go back to re-pick the companion', () => {
    renderModal()
    fireEvent.click(screen.getByText('爱丽丝'))
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
