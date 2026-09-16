// @vitest-environment jsdom
/**
 * CompanionEditModal — dialog semantics, validation gating and save payload.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { CompanionEditModal } from '../../../src/renderer/src/components/CompanionEditModal'

afterEach(() => {
  cleanup()
})

function renderModal(overrides: Partial<Parameters<typeof CompanionEditModal>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  const utils = render(
    <CompanionEditModal
      companion={null}
      isCreating
      onSave={onSave}
      onClose={onClose}
      {...overrides}
    />
  )
  return { onSave, onClose, ...utils }
}

describe('CompanionEditModal', () => {
  it('exposes dialog semantics with an accessible title', () => {
    renderModal()
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('companion-edit-title')
    expect(screen.getByText('添加自定义角色')).toBeTruthy()
  })

  it('labels every form control', () => {
    renderModal()
    for (const label of ['名字', '性别', '年龄', '身份']) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
  })

  it('disables save until name and identity are filled', () => {
    const { onSave } = renderModal()
    const save = screen.getByText('创建') as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '小苏' } })
    expect(save.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('身份'), { target: { value: '哲学导师' } })
    expect(save.disabled).toBe(false)

    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: '小苏', identity: '哲学导师' })
  })

  it('splits keywords on both comma styles and trims them', () => {
    const { onSave } = renderModal()
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('身份'), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText('性格关键词 (逗号分隔)'), {
      target: { value: '温和， 耐心,幽默 ,, ' }
    })
    fireEvent.click(screen.getByText('创建'))

    expect(onSave.mock.calls[0][0].personalityKeywords).toEqual(['温和', '耐心', '幽默'])
  })

  it('closes on Escape and on backdrop click', () => {
    const { onClose, container } = renderModal()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    // Backdrop is the outermost fixed container.
    const backdrop = container.firstElementChild as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('does not close when clicking inside the dialog panel', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
