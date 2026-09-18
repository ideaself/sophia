// @vitest-environment jsdom
/**
 * SettingsProvidersSection — provider list, add/edit modal, model fetching,
 * connection tests, activation and deletion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { SettingsProvidersSection } from '../../../src/renderer/src/components/SettingsProvidersSection'

const providers = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  setActive: vi.fn(),
  setApiKey: vi.fn(),
  testConnection: vi.fn()
}

const PROVIDER = {
  id: 'prov_1',
  name: 'DeepSeek 主号',
  type: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  selectedModel: 'deepseek-v4-flash',
  isActive: true,
  createdAt: '2026-09-16T10:00:00Z',
  updatedAt: '2026-09-16T10:00:00Z'
}

beforeEach(() => {
  for (const fn of Object.values(providers)) fn.mockClear()
  providers.list.mockResolvedValue([PROVIDER])
  providers.create.mockResolvedValue({ id: 'prov_new' })
  providers.update.mockResolvedValue({ id: 'prov_1' })
  providers.delete.mockResolvedValue(true)
  providers.setActive.mockResolvedValue({ id: 'prov_1' })
  providers.setApiKey.mockResolvedValue(undefined)
  providers.testConnection.mockResolvedValue({ success: true, message: 'Connection successful', models: [] })

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { providers }
  })
})

afterEach(cleanup)

function openAddModal(): void {
  fireEvent.click(screen.getByText('+ 添加模型服务'))
}

function fillRequired(name = '新服务', baseUrl = 'https://api.example.com/v1'): void {
  fireEvent.change(screen.getByPlaceholderText('我的服务'), { target: { value: name } })
  fireEvent.change(screen.getByPlaceholderText('https://api.deepseek.com/v1'), {
    target: { value: baseUrl }
  })
}

describe('SettingsProvidersSection — list', () => {
  it('renders providers with active badge and model count', async () => {
    render(<SettingsProvidersSection />)

    expect(await screen.findByText('DeepSeek 主号')).toBeTruthy()
    expect(screen.getByText('当前')).toBeTruthy()
    expect(screen.getByText('deepseek')).toBeTruthy()
    expect(screen.getByText('https://api.deepseek.com/v1')).toBeTruthy()
    expect(screen.getByText(/2 个可用/)).toBeTruthy()
    // The active provider hides the "set default" action.
    expect(screen.queryByText('设为默认')).toBeNull()
  })

  it('shows the empty state without providers', async () => {
    providers.list.mockResolvedValue([])
    render(<SettingsProvidersSection />)

    expect(await screen.findByText(/添加一个模型服务即可开始使用/)).toBeTruthy()
  })

  it('activates and deletes providers', async () => {
    providers.list.mockResolvedValue([{ ...PROVIDER, isActive: false }])
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    fireEvent.click(screen.getByText('设为默认'))
    await waitFor(() => expect(providers.setActive).toHaveBeenCalledWith('prov_1'))
    expect(providers.list).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getByText('取消'))
    expect(providers.delete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getByText('确认删除'))
    await waitFor(() => expect(providers.delete).toHaveBeenCalledWith('prov_1'))
  })
})

describe('SettingsProvidersSection — add/edit modal', () => {
  it('creates a provider from the modal', async () => {
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    const createButton = screen.getByText('创建') as HTMLButtonElement
    expect(createButton.disabled).toBe(true)

    fillRequired()
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-new' } })
    expect(createButton.disabled).toBe(false)
    fireEvent.click(createButton)

    await waitFor(() =>
      expect(providers.create).toHaveBeenCalledWith({
        name: '新服务',
        type: 'custom',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-new',
        models: [],
        selectedModel: ''
      })
    )
    await waitFor(() => expect(screen.queryByText('创建')).toBeNull())
  })

  it('updates a provider and rotates the key when one is typed', async () => {
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    fireEvent.click(screen.getByText('编辑'))
    const nameInput = (await screen.findByPlaceholderText('我的服务')) as HTMLInputElement
    expect(nameInput.value).toBe('DeepSeek 主号')

    fireEvent.change(nameInput, { target: { value: '改名后的服务' } })
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-rotated' } })
    fireEvent.click(screen.getByText('更新'))

    await waitFor(() =>
      expect(providers.update).toHaveBeenCalledWith('prov_1', {
        name: '改名后的服务',
        type: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
        selectedModel: 'deepseek-v4-flash'
      })
    )
    expect(providers.setApiKey).toHaveBeenCalledWith('prov_1', 'sk-rotated')
    await waitFor(() => expect(providers.list).toHaveBeenCalledTimes(2))
  })

  it('surfaces save failures in the section banner', async () => {
    providers.create.mockRejectedValue(new Error('磁盘已满'))
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fillRequired()
    fireEvent.click(screen.getByText('创建'))

    expect(await screen.findByText('磁盘已满')).toBeTruthy()
  })
})

describe('SettingsProvidersSection — model discovery and tests', () => {
  it('fetches models and selects the first one', async () => {
    providers.testConnection.mockResolvedValue({
      success: true,
      models: ['m-one', 'm-two'],
      message: 'Found 2 models'
    })
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fillRequired()
    fireEvent.click(screen.getByText('获取模型'))

    expect(await screen.findByText(/成功：Found 2 models/)).toBeTruthy()
    const select = screen.getByRole('combobox') as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('m-one'))
    expect(providers.testConnection).toHaveBeenCalledWith('https://api.example.com/v1', '__skip__')
  })

  it('reports model-fetch failures and thrown errors', async () => {
    providers.testConnection.mockResolvedValueOnce({ success: false, error: '401 Unauthorized' })
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fillRequired()
    fireEvent.click(screen.getByText('获取模型'))
    expect(await screen.findByText(/错误：401 Unauthorized/)).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()

    providers.testConnection.mockRejectedValueOnce(new Error('network down'))
    fireEvent.click(screen.getByText('获取模型'))
    expect(await screen.findByText(/错误：network down/)).toBeTruthy()
  })

  it('tests the connection and can switch the provider type preset', async () => {
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fireEvent.click(screen.getByText('deepseek'))
    expect((screen.getByPlaceholderText('https://api.deepseek.com/v1') as HTMLInputElement).value).toBe(
      'https://api.deepseek.com/v1'
    )

    fireEvent.click(screen.getByText('测试连接'))
    expect(await screen.findByText(/成功：Connection successful/)).toBeTruthy()

    providers.testConnection.mockResolvedValueOnce({ success: false, error: 'Connection failed' })
    fireEvent.click(screen.getByText('测试连接'))
    expect(await screen.findByText(/错误：Connection failed/)).toBeTruthy()
  })
})

describe('SettingsProvidersSection — modal interactions', () => {
  it('closes the modal from the header and the footer buttons', async () => {
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fireEvent.click(screen.getByText('x'))
    await waitFor(() => expect(screen.queryByPlaceholderText('我的服务')).toBeNull())

    openAddModal()
    fireEvent.click(screen.getByText('取消'))
    await waitFor(() => expect(screen.queryByPlaceholderText('我的服务')).toBeNull())
  })

  it('applies the other type presets and edits a discovered model', async () => {
    providers.testConnection.mockResolvedValue({
      success: true,
      models: ['m-one', 'm-two'],
      message: 'ok'
    })
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    // Switch to the MiMo preset, then to custom.
    fireEvent.click(screen.getByText('MiMo'))
    fireEvent.click(screen.getByText('自定义'))

    fillRequired()
    fireEvent.click(screen.getByText('获取模型'))
    const select = await screen.findByRole('combobox')
    fireEvent.change(select, { target: { value: 'm-two' } })
    expect((select as HTMLSelectElement).value).toBe('m-two')
  })

  it('reports a non-Error test failure with the fallback message', async () => {
    providers.testConnection.mockRejectedValueOnce('plain failure')
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fireEvent.click(screen.getByText('测试连接'))

    expect(await screen.findByText(/错误：Failed/)).toBeTruthy()
  })

  it('reports model-fetch failures with the message and with the generic fallback', async () => {
    providers.testConnection.mockResolvedValueOnce({ success: false, message: '暂无模型' })
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fillRequired()
    fireEvent.click(screen.getByText('获取模型'))
    expect(await screen.findByText(/错误：暂无模型/)).toBeTruthy()

    providers.testConnection.mockResolvedValueOnce({ success: false })
    fireEvent.click(screen.getByText('获取模型'))
    expect(await screen.findByText(/错误：No models found/)).toBeTruthy()
  })

  it('reports a non-Error model-fetch rejection', async () => {
    providers.testConnection.mockRejectedValueOnce('plain failure')
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fillRequired()
    fireEvent.click(screen.getByText('获取模型'))
    expect(await screen.findByText(/错误：Failed/)).toBeTruthy()
  })

  it('fills discovered models from a passing connection test', async () => {
    providers.testConnection.mockResolvedValueOnce({
      success: true,
      models: ['m-one', 'm-two']
    })
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fillRequired()
    fireEvent.click(screen.getByText('测试连接'))

    expect(await screen.findByText(/成功：Connection successful/)).toBeTruthy()
    const select = await screen.findByRole('combobox')
    expect((select as HTMLSelectElement).value).toBe('m-one')
  })

  it('falls back to Connection failed without an error string', async () => {
    providers.testConnection.mockResolvedValueOnce({ success: false })
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fillRequired()
    fireEvent.click(screen.getByText('测试连接'))
    expect(await screen.findByText(/错误：Connection failed/)).toBeTruthy()
  })

  it('reports an Error thrown by the connection test', async () => {
    providers.testConnection.mockRejectedValueOnce(new Error('socket closed'))
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fillRequired()
    fireEvent.click(screen.getByText('测试连接'))
    expect(await screen.findByText(/错误：socket closed/)).toBeTruthy()
  })

  it('updates a provider without rotating the key when it is left blank', async () => {
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    fireEvent.click(screen.getByText('编辑'))
    await screen.findByPlaceholderText('我的服务')
    fireEvent.click(screen.getByText('更新'))

    await waitFor(() =>
      expect(providers.update).toHaveBeenCalledWith('prov_1', expect.objectContaining({ name: 'DeepSeek 主号' }))
    )
    expect(providers.setApiKey).not.toHaveBeenCalled()
  })

  it('falls back to Save failed for a non-Error save rejection', async () => {
    providers.create.mockRejectedValueOnce('plain failure')
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fillRequired()
    fireEvent.click(screen.getByText('创建'))

    expect(await screen.findByText('Save failed')).toBeTruthy()
  })

  it('shows the unselected-model placeholder', async () => {
    providers.list.mockResolvedValue([{ ...PROVIDER, isActive: false, selectedModel: '' }])
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    expect(screen.getByText('未选择')).toBeTruthy()
  })

  it('accepts a manually typed model name', async () => {
    render(<SettingsProvidersSection />)
    await screen.findByText('DeepSeek 主号')

    openAddModal()
    fillRequired()
    const customModelInput = screen.getByPlaceholderText('例如 deepseek-v4-pro')
    fireEvent.change(customModelInput, { target: { value: 'my-model' } })
    expect((customModelInput as HTMLInputElement).value).toBe('my-model')
  })
})
