// @vitest-environment jsdom
/**
 * TTSControlPanel — progress readout and transport controls.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { TTSControlPanel } from '../../../src/renderer/src/components/TTSControlPanel'

afterEach(cleanup)

function makeTts(overrides: Record<string, unknown> = {}): {
  tts: Parameters<typeof TTSControlPanel>[0]['tts']
  spies: Record<string, ReturnType<typeof vi.fn>>
} {
  const spies = {
    resume: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    setLoop: vi.fn(),
    setRate: vi.fn()
  }
  const tts = {
    speaking: true,
    paused: false,
    progress: 0.42,
    rate: 1,
    loop: false,
    ...spies,
    ...overrides
  } as unknown as Parameters<typeof TTSControlPanel>[0]['tts']
  return { tts, spies }
}

describe('TTSControlPanel', () => {
  it('shows the progress percentage and a pause control while speaking', () => {
    const { tts } = makeTts()
    render(<TTSControlPanel tts={tts} />)

    expect(screen.getByText('42%')).toBeTruthy()
    expect(screen.getByText('1.00x')).toBeTruthy()

    const pause = screen.getByLabelText('暂停朗读') as HTMLButtonElement
    expect(pause.disabled).toBe(false)
  })

  it('disables pause when nothing is being spoken', () => {
    const { tts } = makeTts({ speaking: false, progress: 0 })
    render(<TTSControlPanel tts={tts} />)

    expect((screen.getByLabelText('暂停朗读') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('0%')).toBeTruthy()
  })

  it('pauses through the pause control', () => {
    const { tts, spies } = makeTts()
    render(<TTSControlPanel tts={tts} />)

    fireEvent.click(screen.getByLabelText('暂停朗读'))
    expect(spies.pause).toHaveBeenCalledTimes(1)
  })

  it('resumes when paused and stops the speech', () => {
    const { tts, spies } = makeTts({ paused: true })
    render(<TTSControlPanel tts={tts} />)

    fireEvent.click(screen.getByLabelText('继续朗读'))
    expect(spies.resume).toHaveBeenCalledTimes(1)
    // The pause button is replaced while paused.
    expect(screen.queryByLabelText('暂停朗读')).toBeNull()

    fireEvent.click(screen.getByLabelText('停止朗读'))
    expect(spies.stop).toHaveBeenCalledTimes(1)
  })

  it('toggles loop and adjusts the speech rate', () => {
    const { tts, spies } = makeTts()
    render(<TTSControlPanel tts={tts} />)

    const loop = screen.getByLabelText('循环播放')
    expect(loop.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(loop)
    expect(spies.setLoop).toHaveBeenCalledWith(true)

    fireEvent.change(screen.getByLabelText('朗读语速'), { target: { value: '1.75' } })
    expect(spies.setRate).toHaveBeenCalledWith(1.75)
  })

  it('marks the loop button active while looping', () => {
    const { tts } = makeTts({ loop: true })
    render(<TTSControlPanel tts={tts} />)

    const loop = screen.getByLabelText('循环播放')
    expect(loop.getAttribute('aria-pressed')).toBe('true')
    expect(loop.className).toContain('border-accent')
    expect(screen.getByTitle('循环播放：开（点击关闭）')).toBeTruthy()
  })
})
