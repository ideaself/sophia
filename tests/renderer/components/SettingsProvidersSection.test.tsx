// @vitest-environment jsdom
/**
 * SettingsProvidersSection — extracted model-provider settings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

import { SettingsProvidersSection } from '../../../src/renderer/src/components/SettingsProvidersSection'

const existingProvider = {
  id: 'prov_1',
  name: 'DeepSeek 官方',
  type: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  selectedModel: 'deepseek-v4-pro',
  isActive: true,
  createdAt: '2026-07-06T09:00:00Z',
  updatedAt: '2026-07-06T09:00:00Z'
}

const providersApi = {
  list: vi.fn(),
  get: vi.fn(),
  getActive: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  setActive: vi.fn(),
  setApiKey: vi.fn(),
  hasApiKey: vi.fn(),
  fetchModels: vi.fn(),
  testConnection: vi.fn()
}

beforeEach(() => {
  for (const fn of Object.values(providersApi)) fn.mockClear()
  providersApi.list.mockResolvedValue([existingProvider])
  providersApi.testConnection.mockResolvedValue({ success: true, models: [], message: 'ok' })
  providersApi.create.mockResolvedValue(existingProvider)

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { providers: providersApi }
  })
})

afterEach(() => {
  cleanup()
})

describe('SettingsProvidersSection', () => {
  it('lists configured providers with their base URL and active badge', async () => {
    render(<SettingsProvidersSection />)

    expect(await screen.findByText('DeepSeek 官方')).toBeTruthy()
    expect(screen.getByText('https://api.deepseek.com/v1')).toBeTruthy()
    expect(screen.getByText('当前')).toBeTruthy()
    // Badge in the section title reflects the provider count.
    expect(screen.getByText('1 个服务')).toBeTruthy()
  })

  it('shows the empty state when no provider is configured', async () => {
    providersApi.list.mockResolvedValueOnce([])
    render(<SettingsProvidersSection />)

    expect(await screen.findByText('尚未配置模型服务')).toBeTruthy()
    expect(screen.getByText('+ 添加模型服务')).toBeTruthy()
  })

  it('opens the create modal with save disabled until required fields are filled', async () => {
    providersApi.list.mockResolvedValueOnce([])
    render(<SettingsProvidersSection />)
    await screen.findByText('尚未配置模型服务')

    fireEvent.click(screen.getByText('+ 添加模型服务'))
    expect(await screen.findByText('添加模型服务', { selector: 'h3' })).toBeTruthy()

    const createButton = screen.getByText('创建') as HTMLButtonElement
    expect(createButton.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('我的服务'), { target: { value: '我的服务' } })
    // Base URL defaults to the DeepSeek preset when adding.
    await waitFor(() => expect(createButton.disabled).toBe(false))

    fireEvent.click(createButton)
    await waitFor(() => expect(providersApi.create).toHaveBeenCalledTimes(1))
    expect(providersApi.create.mock.calls[0][0]).toMatchObject({ name: '我的服务' })
  })

  it('deletes a provider after inline confirmation', async () => {
    providersApi.delete.mockResolvedValue(true)
    providersApi.list.mockResolvedValue([existingProvider])
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 官方')

    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getByText('确认删除'))

    await waitFor(() => expect(providersApi.delete).toHaveBeenCalledWith('prov_1'))
  })
})
