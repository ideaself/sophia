/**
 * chat-stream.ts IPC — session lifecycle, event forwarding to the renderer,
 * cancel handling, input validation and the API-key guarantee.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = (event: unknown, input?: unknown) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sends: [] as Array<{ channel: string; payload: { sessionId?: string } & Record<string, unknown> }>,
  failStart: false,
  adapterParams: [] as Array<Record<string, unknown>>,
  cancelFlags: [] as string[]
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      mocks.handlers.set(channel, fn)
    }
  }
}))

vi.mock('../../../src/main/ipc/safe-send', () => ({
  safeSend: (_wc: unknown, channel: string, payload: Record<string, unknown>) => {
    mocks.sends.push({ channel, payload })
  }
}))

vi.mock('../../../src/main/llm/stream-chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/llm/stream-chat')>()
  return {
    StreamChatSession: class extends actual.StreamChatSession {
      start(): Promise<void> {
        if (mocks.failStart) return Promise.reject(new Error('boom'))
        return super.start()
      }
    }
  }
})

import { registerChatStreamIpc, DEEPSEEK_MODELS } from '../../../src/main/ipc/chat-stream'
import { CHAT_STREAM_EVENT, CHAT_STREAM_START, CHAT_STREAM_CANCEL } from '../../../src/shared/channel-names'

const fakeWebContents = { id: 1 }

function chunkStream(chunks: Array<Record<string, unknown>>): AsyncIterable<never> {
  return (async function* () {
    for (const chunk of chunks) yield chunk
  })() as AsyncIterable<never>
}

/** A stream that keeps yielding until cancelled (records its cleanup). */
function hangingStream(
  label: string,
  params: Record<string, unknown>
): AsyncIterable<never> {
  const signal = params.signal as AbortSignal
  return (async function* () {
    try {
      while (!signal.aborted) {
        yield { choices: [{ delta: { content: 'x' }, finish_reason: null }] }
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    } finally {
      mocks.cancelFlags.push(label)
    }
  })() as AsyncIterable<never>
}

/** OpenAI-style streaming chunks as produced by the DeepSeek adapter. */
const CHUNKS = [
  { choices: [{ delta: { content: '你好' }, finish_reason: null }] },
  { choices: [{ delta: { reasoning_content: '想一下' }, finish_reason: null }] },
  { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  { choices: [{ delta: {}, finish_reason: 'stop' }] }
]

let sessions: Map<string, unknown>

async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return (await handler({}, input)) as T
}

function setup(
  adapter: (params: Record<string, unknown>) => AsyncIterable<never> = () =>
    chunkStream([{ type: 'end', finishReason: 'stop' }]),
  overrides: { readApiKey?: () => Promise<string | null>; provider?: () => Promise<{ model: string; baseUrl: string } | null> } = {}
): void {
  mocks.handlers.clear()
  mocks.sends.length = 0
  mocks.adapterParams.length = 0
  mocks.cancelFlags.length = 0
  sessions = registerChatStreamIpc(
    () => fakeWebContents as never,
    (params) => {
      mocks.adapterParams.push(params as unknown as Record<string, unknown>)
      return adapter(params as unknown as Record<string, unknown>)
    },
    overrides.readApiKey ?? (async () => 'sk-test'),
    overrides.provider
  ) as Map<string, unknown>
}

beforeEach(() => {
  mocks.failStart = false
})

describe('chat-stream IPC — start', () => {
  it('starts a session, forwards every event kind and cleans up', async () => {
    setup(() => chunkStream(CHUNKS) as AsyncIterable<never>)

    const sessionId = await invoke<string>(CHAT_STREAM_START, {
      messages: [{ role: 'user', content: 'hi' }]
    })

    expect(sessionId).toMatch(/^stream-\d+-\d+$/)
    await vi.waitFor(() => expect(mocks.sends.length).toBeGreaterThanOrEqual(4))

    const byChannel = new Map(mocks.sends.map((s) => [s.channel, s.payload]))
    expect(byChannel.get(CHAT_STREAM_EVENT.token)).toMatchObject({ sessionId, token: '你好' })
    expect(byChannel.get(CHAT_STREAM_EVENT.thinking)).toMatchObject({ sessionId, text: '想一下' })
    expect(byChannel.get(CHAT_STREAM_EVENT.usage)).toMatchObject({
      sessionId,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15
    })
    expect(byChannel.get(CHAT_STREAM_EVENT.end)).toMatchObject({ sessionId, finishReason: 'stop' })

    // Completed sessions are removed from the registry.
    await vi.waitFor(() => expect(sessions.size).toBe(0))
  })

  it('passes the key, provider model/endpoint and thinking flag to the adapter', async () => {
    setup(
      () => chunkStream([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]) as AsyncIterable<never>,
      { provider: async () => ({ model: 'provider-model', baseUrl: 'https://api.example.com' }) }
    )

    await invoke(CHAT_STREAM_START, {
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
      thinking: true
    })

    expect(mocks.adapterParams[0]).toMatchObject({
      model: 'provider-model',
      apiKey: 'sk-test',
      _endpoint: 'https://api.example.com',
      thinking: true
    })
  })

  it('falls back to the requested/default model without an active provider', async () => {
    setup()
    await invoke(CHAT_STREAM_START, { messages: [{ role: 'user', content: 'hi' }] })
    expect(mocks.adapterParams[0].model).toBe('deepseek-v4-pro')
    expect(DEEPSEEK_MODELS).toContain('deepseek-v4-flash')

    await invoke(CHAT_STREAM_START, {
      messages: [{ role: 'user', content: 'hi' }],
      model: 'deepseek-v4-flash'
    })
    expect(mocks.adapterParams[1].model).toBe('deepseek-v4-flash')
    expect(mocks.adapterParams[1].thinking).toBe(false)
  })

  it('refuses to start without an API key', async () => {
    setup(undefined, { readApiKey: async () => null })
    await expect(
      invoke(CHAT_STREAM_START, { messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('API key not configured')
    expect(mocks.adapterParams).toHaveLength(0)
  })

  it('validates the request payload', async () => {
    setup()
    await expect(invoke(CHAT_STREAM_START, { messages: [] })).rejects.toThrow()
    await expect(
      invoke(CHAT_STREAM_START, {
        messages: Array.from({ length: 201 }, () => ({ role: 'user', content: 'x' }))
      })
    ).rejects.toThrow()
    await expect(
      invoke(CHAT_STREAM_START, { messages: [{ role: 'user', content: 'x'.repeat(32769) }] })
    ).rejects.toThrow()
    await expect(
      invoke(CHAT_STREAM_START, {
        messages: [{ role: 'user', content: 'x' }, { role: 'system', content: 'late system' }]
      })
    ).rejects.toThrow(/only allowed as the first message/)
  })

  it('swallows session failures and still cleans up', async () => {
    mocks.failStart = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      setup()
      const sessionId = await invoke<string>(CHAT_STREAM_START, {
        messages: [{ role: 'user', content: 'hi' }]
      })
      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith('[chat-stream] session error:', expect.any(Error))
      )
      await vi.waitFor(() => expect(sessions.has(sessionId)).toBe(false))
    } finally {
      error.mockRestore()
    }
  })
})

describe('chat-stream IPC — cancel', () => {
  it('cancels a running session and tears the adapter down', async () => {
    setup((params) => hangingStream('first', params))
    const sessionId = await invoke<string>(CHAT_STREAM_START, {
      messages: [{ role: 'user', content: 'hi' }]
    })

    await invoke(CHAT_STREAM_CANCEL, { sessionId })

    await vi.waitFor(() => expect(mocks.cancelFlags).toContain('first'))
    await vi.waitFor(() => expect(sessions.has(sessionId)).toBe(false))
  })

  it('ignores cancels for unknown sessions and validates input', async () => {
    setup()
    await expect(invoke(CHAT_STREAM_CANCEL, { sessionId: 'missing' })).resolves.toBeUndefined()
    await expect(invoke(CHAT_STREAM_CANCEL, { sessionId: '' })).rejects.toThrow()
  })
})
