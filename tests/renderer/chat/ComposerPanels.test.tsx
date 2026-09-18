// @vitest-environment jsdom
/**
 * MathSymbolPanel + TemplatePanel — composer quick-insert popovers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { MathSymbolPanel } from '../../../src/renderer/src/chat/MathSymbolPanel'
import { TemplatePanel } from '../../../src/renderer/src/chat/TemplatePanel'
import { saveTextTemplates } from '../../../src/shared/text-templates'

afterEach(() => {
  cleanup()
})

describe('MathSymbolPanel', () => {
  it('shows the greek group by default and inserts a symbol on click', () => {
    const onInsert = vi.fn()
    render(<MathSymbolPanel tab="greek" onSelectTab={() => {}} onInsert={onInsert} />)

    fireEvent.click(screen.getByTitle('α'))
    expect(onInsert).toHaveBeenCalledWith('α')
  })

  it('switches the item grid when another group is selected', () => {
    const onSelectTab = vi.fn()
    const { rerender } = render(
      <MathSymbolPanel tab="greek" onSelectTab={onSelectTab} onInsert={() => {}} />
    )

    fireEvent.click(screen.getByText('运算符号'))
    expect(onSelectTab).toHaveBeenCalledWith('ops')

    rerender(<MathSymbolPanel tab="ops" onSelectTab={onSelectTab} onInsert={() => {}} />)
    fireEvent.click(screen.getByTitle('∫'))
    expect(screen.getByTitle('∫')).toBeTruthy()
  })

  it('labels long formula templates as 模板', () => {
    render(<MathSymbolPanel tab="templates" onSelectTab={() => {}} onInsert={() => {}} />)
    expect(screen.getByTitle('\\frac{a}{b}')).toBeTruthy()
    expect(screen.getAllByText('模板').length).toBeGreaterThan(0)
  })

  it('falls back to the first group for an unknown tab', () => {
    render(<MathSymbolPanel tab="unknown" onSelectTab={() => {}} onInsert={() => {}} />)
    expect(screen.getByTitle('α')).toBeTruthy()
  })
})

describe('TemplatePanel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows the empty-state hint pointing at settings', () => {
    render(<TemplatePanel onInsert={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/还没有模板/)).toBeTruthy()
  })

  it('lists saved templates with Alt+N hints and inserts on click', () => {
    saveTextTemplates(['请举个例子', '换种解释'])
    const onInsert = vi.fn()
    render(<TemplatePanel onInsert={onInsert} onClose={() => {}} />)

    expect(screen.getByText('Alt+1')).toBeTruthy()
    expect(screen.getByText('Alt+2')).toBeTruthy()

    fireEvent.click(screen.getByText('换种解释'))
    expect(onInsert).toHaveBeenCalledWith('换种解释')
  })

  it('closes via the panel close button', () => {
    const onClose = vi.fn()
    render(<TemplatePanel onInsert={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('关闭模板面板'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
