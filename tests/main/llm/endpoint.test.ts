import { describe, it, expect } from 'vitest'

import { assertHttpsEndpoint } from '../../../src/main/llm/endpoint'

describe('assertHttpsEndpoint', () => {
  it('throws for http:// URLs', () => {
    expect(() => assertHttpsEndpoint('http://api.example.com/v1')).toThrow(
      'Endpoint must use HTTPS'
    )
  })

  it('throws for http:// URLs on any host including localhost', () => {
    expect(() => assertHttpsEndpoint('http://localhost:8080/v1')).toThrow(
      'Endpoint must use HTTPS'
    )
  })

  it('does not leak the URL in the error message', () => {
    let message = ''
    try {
      assertHttpsEndpoint('http://my-sensitive-host.internal/v1')
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).not.toContain('my-sensitive-host')
    expect(message).not.toContain('http://')
  })

  it('allows https:// URLs', () => {
    expect(() => assertHttpsEndpoint('https://api.deepseek.com/v1')).not.toThrow()
  })
})
