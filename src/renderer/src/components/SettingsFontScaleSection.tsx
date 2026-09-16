import { useState } from 'react'
import {
  FONT_SCALE_OPTIONS,
  getFontScale,
  setFontScale,
  type FontScale
} from '../../../shared/font-scale'

/**
 * 界面字号设置（拆分自 SettingsView）。
 */
export function SettingsFontScaleSection(): React.ReactElement {
  const [fontScale, setFontScaleState] = useState<FontScale>(() => getFontScale())

  const handleFontScale = (scale: FontScale) => {
    setFontScaleState(scale)
    setFontScale(scale)
  }

  return (
    <>
      <div className="mb-8">
        <h3 className="mb-3 text-lg font-semibold">界面字号</h3>
        <p className="mb-3 text-xs text-text-muted">调整整个界面的文字大小（课堂教材阅读器的字号不受影响）。</p>
        <div className="flex gap-2">
          {FONT_SCALE_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => handleFontScale(o.key)}
              className={`rounded px-4 py-2 text-sm transition-colors ${
                fontScale === o.key
                  ? 'bg-accent text-white'
                  : 'border border-surface-border-strong text-text-secondary hover:bg-bg-elevated'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
