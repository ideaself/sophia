import type { UseTTSResult } from '../hooks/useTTS'

interface TTSControlPanelProps {
  tts: UseTTSResult
}

/** Shared TTS popover: progress bar + pause/resume/stop + rate slider. */
export function TTSControlPanel({ tts }: TTSControlPanelProps): React.ReactElement {
  return (
    <div className="w-64 rounded-lg border border-surface-border bg-bg-surface p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
        <span>朗读控制</span>
        <span className="tabular-nums">{Math.round(tts.progress * 100)}%</span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded bg-bg-deep">
        <div
          className="h-full rounded bg-accent transition-[width] duration-150"
          style={{ width: `${Math.round(tts.progress * 100)}%` }}
        />
      </div>
      <div className="flex items-center gap-2">
        {tts.paused ? (
          <button
            onClick={(e) => { e.stopPropagation(); tts.resume() }}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
            title="继续朗读"
          >
            ▶️
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); tts.pause() }}
            disabled={!tts.speaking}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated disabled:opacity-40"
            title="暂停"
          >
            ⏸️
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); tts.stop() }}
          className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
          title="停止"
        >
          ⏹️
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); tts.setLoop(!tts.loop) }}
          className={`rounded border px-2 py-1 text-xs transition-colors ${
            tts.loop
              ? 'border-accent text-accent'
              : 'border-surface-border-strong hover:bg-bg-elevated'
          }`}
          title={tts.loop ? '循环播放：开（点击关闭）' : '循环播放：关（点击开启）'}
        >
          🔁
        </button>
        <div className="flex flex-1 items-center gap-2">
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.25}
            value={tts.rate}
            onChange={(e) => tts.setRate(Number(e.target.value))}
            className="flex-1"
            title="语速"
          />
          <span className="w-9 text-right text-xs tabular-nums text-text-muted">
            {tts.rate.toFixed(2)}x
          </span>
        </div>
      </div>
    </div>
  )
}
