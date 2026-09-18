// @vitest-environment jsdom
/**
 * ErrorBoundary — the app-wide crash guard.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { ErrorBoundary } from '../../../src/renderer/src/components/ErrorBoundary'

// React logs caught errors to console.error — keep test output clean.
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

afterEach(() => {
  cleanup()
})

let shouldThrow = false

function Bomb(): React.ReactElement {
  if (shouldThrow) throw new Error('boom from child')
  return <div>正常运行</div>
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    shouldThrow = false
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )
    expect(screen.getByText('正常运行')).toBeTruthy()
  })

  it('renders the fallback with the error message when a child throws', () => {
    shouldThrow = true
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    expect(screen.getByText('应用遇到错误')).toBeTruthy()
    expect(screen.getByText('boom from child')).toBeTruthy()
    expect(screen.getByText('重试')).toBeTruthy()
    expect(screen.getByText('刷新页面')).toBeTruthy()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('recovers after the retry button when the child no longer throws', () => {
    shouldThrow = true
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )
    expect(screen.getByText('应用遇到错误')).toBeTruthy()

    shouldThrow = false
    fireEvent.click(screen.getByText('重试'))

    expect(screen.getByText('正常运行')).toBeTruthy()
    expect(screen.queryByText('应用遇到错误')).toBeNull()
  })

  it('falls back to the unknown-error label for a non-Error throw', () => {
    function StringBomb(): React.ReactElement {
      throw 'string boom'
    }
    render(
      <ErrorBoundary>
        <StringBomb />
      </ErrorBoundary>
    )

    expect(screen.getByText('应用遇到错误')).toBeTruthy()
    expect(screen.getByText('未知错误')).toBeTruthy()
  })

  it('reloads the page from the error card', () => {
    shouldThrow = true
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload }
    })
    try {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      )

      fireEvent.click(screen.getByText('刷新页面'))
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      shouldThrow = false
    }
  })
})
