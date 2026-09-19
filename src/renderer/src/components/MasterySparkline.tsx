/**
 * 概念掌握度迷你趋势图（SVG 折线）：历史点不足 2 个时不渲染。
 */
import type { MasteryPoint } from '../../../shared/concept-mastery'

const WIDTH = 120
const HEIGHT = 28
const PAD = 3

export function MasterySparkline({ history }: { history: MasteryPoint[] }): React.ReactElement | null {
  if (history.length < 2) return null

  const innerW = WIDTH - PAD * 2
  const innerH = HEIGHT - PAD * 2
  const xs = history.map((_, i) => PAD + (i * innerW) / (history.length - 1))
  const ys = history.map((p) => HEIGHT - PAD - Math.min(1, Math.max(0, p.m)) * innerH)
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  const first = Math.round(history[0].m * 100)
  const last = Math.round(history[history.length - 1].m * 100)

  return (
    <span
      className="inline-flex items-center gap-2"
      title={`掌握度趋势：${first}% → ${last}%`}
    >
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="2" fill="var(--accent)" />
      </svg>
      <span className="text-[10px] text-text-muted">
        {first}% → {last}%
      </span>
    </span>
  )
}
