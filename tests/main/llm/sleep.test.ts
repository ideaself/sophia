/**
 * sleepWithAbort — abort-aware backoff sleep.
 */
import { describe, it, expect } from 'vitest'
import { getEventListeners } from 'node:events'

import { sleepWithAbort, createAbortError } from '../../../src/main/llm/sleep'

describe('sleepWithAbort', () => {
  it('resolves after the delay and removes its abort listener', async () => {
    const controller = new AbortController()
    const promise = sleepWithAbort(5, controller.signal)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)

    await expect(promise).resolves.toBeUndefined()

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('resolves without a signal', async () => {
    await expect(sleepWithAbort(5)).resolves.toBeUndefined()
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(sleepWithAbort(1000, controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
  })

  it('rejects early when the signal fires mid-sleep', async () => {
    const controller = new AbortController()
    const promise = sleepWithAbort(30_000, controller.signal)
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('createAbortError labels the error as an AbortError', () => {
    const err = createAbortError()
    expect(err.name).toBe('AbortError')
    expect(err.message).toContain('aborted')
  })
})
