// @vitest-environment jsdom
/**
 * MasterySparkline — mini SVG trend: hidden below two points, otherwise a
 * polyline plus the first → last percentage label.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MasterySparkline } from '../../../src/renderer/src/components/MasterySparkline'

afterEach(cleanup)

describe('MasterySparkline', () => {
  it('renders nothing below two data points', () => {
    const { container } = render(<MasterySparkline history={[]} />)
    expect(container.firstChild).toBeNull()

    const single = render(
      <MasterySparkline history={[{ t: '2026-09-01T00:00:00Z', m: 0.5 }]} />
    )
    expect(single.container.firstChild).toBeNull()
  })

  it('plots the trend and labels the endpoints', () => {
    const { container } = render(
      <MasterySparkline
        history={[
          { t: '2026-09-01T00:00:00Z', m: 0.4 },
          { t: '2026-09-02T00:00:00Z', m: 0.3 },
          { t: '2026-09-03T00:00:00Z', m: 0.8 }
        ]}
      />
    )

    expect(screen.getByTitle('掌握度趋势：40% → 80%')).toBeTruthy()
    expect(screen.getByText('40% → 80%')).toBeTruthy()
    const polyline = container.querySelector('polyline')
    expect(polyline).toBeTruthy()
    expect(polyline!.getAttribute('points')?.split(' ')).toHaveLength(3)
    expect(container.querySelector('circle')).toBeTruthy()
  })
})
