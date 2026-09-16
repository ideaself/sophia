// @vitest-environment jsdom
/**
 * Composer-related settings sections: text templates + voice triggers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { SettingsTextTemplatesSection } from '../../../src/renderer/src/components/SettingsTextTemplatesSection'
import { SettingsVoiceTriggersSection } from '../../../src/renderer/src/components/SettingsVoiceTriggersSection'
import { saveTextTemplates } from '../../../src/shared/text-templates'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('SettingsTextTemplatesSection', () => {
  function renderExpanded(): void {
    render(<SettingsTextTemplatesSection />)
    fireEvent.click(screen.getByRole('button', { name: /常用文本模板/ }))
  }

  it('lists saved templates with Alt hints and a count badge', () => {
    saveTextTemplates(['第一条', '第二条'])
    renderExpanded()

    expect(screen.getByText('2/9')).toBeTruthy()
    expect(screen.getByDisplayValue('第一条')).toBeTruthy()
    expect(screen.getByText('Alt+2')).toBeTruthy()
  })

  it('persists edits and supports add/remove', () => {
    saveTextTemplates(['改我'])
    renderExpanded()

    fireEvent.change(screen.getByLabelText('第 1 条快捷模板'), { target: { value: '已修改' } })
    expect(JSON.parse(localStorage.getItem('sophia.textTemplates')!)).toEqual(['已修改'])

    fireEvent.click(screen.getByText('+ 添加模板'))
    expect(JSON.parse(localStorage.getItem('sophia.textTemplates')!)).toEqual(['已修改', ''])

    fireEvent.click(screen.getByLabelText('删除第 1 条模板'))
    expect(JSON.parse(localStorage.getItem('sophia.textTemplates')!)).toEqual([''])
  })
})

describe('SettingsVoiceTriggersSection', () => {
  function renderExpanded(): void {
    render(<SettingsVoiceTriggersSection />)
    fireEvent.click(screen.getByRole('button', { name: /语音输入触发词/ }))
  }

  it('shows default placeholders and persists custom phrases', () => {
    renderExpanded()

    // Both inputs fall back to the defaults via placeholders.
    expect(screen.getAllByPlaceholderText(/默认：/)).toHaveLength(2)

    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: '发射' } })
    fireEvent.change(inputs[1], { target: { value: '清屏' } })

    const saved = JSON.parse(localStorage.getItem('sophia.voiceTriggers')!)
    expect(saved.send).toBe('发射')
    expect(saved.clear).toBe('清屏')
  })
})
