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

  it('edits every remaining field', () => {
    const { onSave } = renderModal()
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '小苏' } })
    fireEvent.change(screen.getByLabelText('身份'), { target: { value: '哲学导师' } })
    fireEvent.change(screen.getByLabelText('性别'), { target: { value: 'female' } })
    fireEvent.change(screen.getByLabelText('年龄'), { target: { value: '36' } })
    fireEvent.change(screen.getByLabelText('性格描述'), { target: { value: '耐心' } })
    fireEvent.change(screen.getByLabelText('说话风格'), { target: { value: '温和' } })
    fireEvent.change(screen.getByLabelText('情感表达'), { target: { value: '微笑' } })
    fireEvent.click(screen.getByText('创建'))

    expect(onSave.mock.calls[0][0]).toMatchObject({
      gender: 'female',
      age: 36,
      personality: '耐心',
      speakingStyle: '温和',
      emotionalExpressions: '微笑'
    })
  })

  it('falls back to age 0 for junk input', () => {
    const { onSave } = renderModal()
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('身份'), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText('年龄'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByText('创建'))

    expect(onSave.mock.calls[0][0].age).toBe(0)
  })

  it('requires a second click to delete an existing companion', () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderModal({
      isCreating: false,
      companion: { id: 'c1', name: '朗道', gender: 'male', age: 40, identity: 'x', personalityKeywords: [] } as never,
      onDelete
    })

    fireEvent.click(screen.getByText('删除角色'))
    expect(onDelete).not.toHaveBeenCalled()

    // The first 取消 belongs to the delete row; the footer has its own.
    fireEvent.click(screen.getAllByText('取消')[0])
    expect(screen.getByText('删除角色')).toBeTruthy()

    fireEvent.click(screen.getByText('删除角色'))
    fireEvent.click(screen.getByText('确认删除'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
