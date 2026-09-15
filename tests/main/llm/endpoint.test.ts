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

  it('throws for uppercase/mixed-case HTTP:// schemes', () => {
    for (const url of ['HTTP://api.example.com/v1', 'HtTp://api.example.com/v1']) {
      expect(() => assertHttpsEndpoint(url), url).toThrow('Endpoint must use HTTPS')
    }
  })

  it('accepts mixed-case HTTPS:// schemes (normalized by URL parser)', () => {
    expect(() => assertHttpsEndpoint('HTTPS://api.deepseek.com/v1')).not.toThrow()
  })

  it('throws for non-http(s) protocols', () => {
    expect(() => assertHttpsEndpoint('ftp://example.com/v1')).toThrow('Endpoint must use HTTPS')
    expect(() => assertHttpsEndpoint('file:///etc/passwd')).toThrow('Endpoint must use HTTPS')
  })

  it('throws for malformed URLs instead of letting them through', () => {
    expect(() => assertHttpsEndpoint('not-a-url')).toThrow('Endpoint must be a valid URL')
    expect(() => assertHttpsEndpoint('')).toThrow('Endpoint must be a valid URL')
  })
})
