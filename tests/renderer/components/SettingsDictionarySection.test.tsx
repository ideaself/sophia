// @vitest-environment jsdom
/**
 * SettingsDictionarySection — dict popup config persisted to localStorage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { SettingsDictionarySection } from '../../../src/renderer/src/components/SettingsDictionarySection'
import { DEFAULT_DICT_TEMPLATE } from '../../../src/shared/dict'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SettingsDictionarySection', () => {
  it('toggles auto-lookup and persists the preference', () => {
    render(<SettingsDictionarySection />)
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    fireEvent.click(checkbox)

    expect(checkbox.checked).toBe(false)
    expect(localStorage.getItem('sophia.dictEnabled')).toBe('0')
  })

  it('persists a custom template and previews its URL', () => {
    render(<SettingsDictionarySection />)
    const input = screen.getByPlaceholderText(DEFAULT_DICT_TEMPLATE)

    fireEvent.change(input, { target: { value: 'https://example.com/lookup?q={word}' } })

    expect(localStorage.getItem('sophia.dictTemplate')).toBe('https://example.com/lookup?q={word}')
    expect(screen.getByText(/example\.com\/lookup\?q=hello/)).toBeTruthy()
  })

  it('opens the test URL in a new window with the encoded word', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<SettingsDictionarySection />)

    fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: 'entropy' } })
    fireEvent.click(screen.getByText('在新窗口测试'))

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('entropy'),
      '_blank'
    )
  })

  it('disables the test button when the word is empty', () => {
    render(<SettingsDictionarySection />)
    fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: '   ' } })
    expect((screen.getByText('在新窗口测试') as HTMLButtonElement).disabled).toBe(true)
  })
})
