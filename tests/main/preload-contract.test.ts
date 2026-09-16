/**
 * Preload bridge contract tests.
 *
 * electron is mocked so the preload module can run in Node: the bridge is
 * captured, then every group is checked for correct channel + payload wiring
 * (spot checks) and the event helpers for subscribe/unsubscribe semantics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn(async () => ({ ok: true })),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener
  }
}))

import type { SophiaAPI } from '../../src/preload/index'
import '../../src/preload/index'

function bridge(): SophiaAPI {
  const call = mocks.expose.mock.calls[0]
  if (!call || call[0] !== 'sophia') throw new Error('bridge not exposed as "sophia"')
  return call[1] as SophiaAPI
}

beforeEach(() => {
  mocks.invoke.mockClear()
  mocks.on.mockClear()
  mocks.removeListener.mockClear()
})

describe('preload bridge surface', () => {
  it('exposes exactly one bridge named "sophia" with the full API groups', () => {
    expect(mocks.expose).toHaveBeenCalledTimes(1)
    const api = bridge()
    for (const group of [
      'getVersion',
      'getPlatform',
      'app',
      'settings',
      'chat',
      'data',
      'companions',
      'dialog',
      'providers',
      'sync',
      'updater'
    ]) {
      expect(api).toHaveProperty(group)
    }
  })

  it('routes app-level calls to their channels', async () => {
    const api = bridge()
    await api.getVersion()
    await api.getPlatform()
    await api.app.openDataDir()
    await api.app.openExternal('https://example.com')

    expect(mocks.invoke).toHaveBeenCalledWith('app:get-version')
    expect(mocks.invoke).toHaveBeenCalledWith('app:get-platform')
    expect(mocks.invoke).toHaveBeenCalledWith('app:open-data-dir')
    expect(mocks.invoke).toHaveBeenCalledWith('app:open-external', 'https://example.com')
  })

  it('routes settings calls without ever exposing the key', async () => {
    const api = bridge()
    await api.settings.hasDeepSeekKey()
    await api.settings.setDeepSeekKey('sk-secret')
    await api.settings.deleteDeepSeekKey()

    expect(mocks.invoke).toHaveBeenCalledWith('settings:has-deepseek-key')
    expect(mocks.invoke).toHaveBeenCalledWith('settings:set-deepseek-key', { key: 'sk-secret' })
    expect(mocks.invoke).toHaveBeenCalledWith('settings:delete-deepseek-key')
    expect(Object.keys(api.settings)).not.toContain('getDeepSeekKey')
    expect(Object.keys(api.settings)).not.toContain('readKey')
  })

  it('routes chat stream calls with their payloads', async () => {
    const api = bridge()
    const messages = [{ role: 'user' as const, content: '你好' }]
    await api.chat.startStream(messages, 'deepseek-v4-flash', true)
    await api.chat.cancelStream('sess-1')
    await api.chat.getPromptMessages({ conversationId: 'conv_1', companionId: 'comp_landau', userMessage: 'hi' })

    expect(mocks.invoke).toHaveBeenCalledWith('chat:stream-start', {
      messages,
      model: 'deepseek-v4-flash',
      thinking: true
    })
    expect(mocks.invoke).toHaveBeenCalledWith('chat:stream-cancel', { sessionId: 'sess-1' })
    expect(mocks.invoke).toHaveBeenCalledWith('chat:get-prompt-messages', {
      conversationId: 'conv_1',
      companionId: 'comp_landau',
      userMessage: 'hi'
    })
  })

  it('routes data calls with their argument wrapping', async () => {
    const api = bridge()
    await api.data.getConversation('conv_1')
    await api.data.listConversations()
    await api.data.listMessages('conv_1')
    await api.data.updateTextbookProgress('tb_1', { currentPage: 3 })
    await api.data.updateMessage('conv_1', 'msg_1', '改过的内容')

    expect(mocks.invoke).toHaveBeenCalledWith('conversation:get', { conversationId: 'conv_1' })
    expect(mocks.invoke).toHaveBeenCalledWith('conversation:list', {})
    expect(mocks.invoke).toHaveBeenCalledWith('message:list', { conversationId: 'conv_1' })
    expect(mocks.invoke).toHaveBeenCalledWith('textbook:update-progress', {
      textbookId: 'tb_1',
      currentPage: 3
    })
    expect(mocks.invoke).toHaveBeenCalledWith('message:update', {
      conversationId: 'conv_1',
      messageId: 'msg_1',
      content: '改过的内容'
    })
  })

  it('routes companions, dialog, providers, sync and updater calls', async () => {
    const api = bridge()
    await api.companions.get('comp_landau')
    await api.dialog.confirm({ message: '下课？' })
    await api.providers.setApiKey('prov_1', 'sk-x')
    await api.sync.hasWebdavPassword()
    await api.updater.checkForUpdates()

    expect(mocks.invoke).toHaveBeenCalledWith('companion:get', { companionId: 'comp_landau' })
    expect(mocks.invoke).toHaveBeenCalledWith('dialog:confirm', { message: '下课？' })
    expect(mocks.invoke).toHaveBeenCalledWith('providers:set-api-key', {
      id: 'prov_1',
      apiKey: 'sk-x'
    })
    expect(mocks.invoke).toHaveBeenCalledWith('sync:has-webdav-password')
    expect(mocks.invoke).toHaveBeenCalledWith('updater:check-for-updates')
  })
})

describe('preload event helpers', () => {
  it('delivers chat stream events only for the subscribed session', () => {
    const api = bridge()
    const onToken = vi.fn()
    const unsubscribe = api.chat.onToken('sess-1', onToken)

    const handler = mocks.on.mock.calls.at(-1)![1] as (event: unknown, payload: unknown) => void
    handler({}, { sessionId: 'sess-2', token: '别的会话' })
    expect(onToken).not.toHaveBeenCalled()

    handler({}, { sessionId: 'sess-1', token: '你好' })
    expect(onToken).toHaveBeenCalledWith('你好')

    unsubscribe()
    expect(mocks.removeListener).toHaveBeenCalledWith('chat:stream:token', handler)
  })

  it('forwards sync progress and dict-blocked events verbatim', () => {
    const api = bridge()
    const onProgress = vi.fn()
    api.sync.onProgress(onProgress)
    const progressHandler = mocks.on.mock.calls.at(-1)![1] as (
      event: unknown,
      payload: unknown
    ) => void
    progressHandler({}, { phase: 'push', percent: 42 })
    expect(onProgress).toHaveBeenCalledWith({ phase: 'push', percent: 42 })

    const onBlocked = vi.fn()
    api.app.onDictFrameBlocked(onBlocked)
    const blockedHandler = mocks.on.mock.calls.at(-1)![1] as (
      event: unknown,
      payload: unknown
    ) => void
    blockedHandler({}, { url: 'https://dict.example' })
    expect(onBlocked).toHaveBeenCalledWith({ url: 'https://dict.example' })
  })
})
