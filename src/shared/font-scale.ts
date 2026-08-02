/**
 * Global UI font scale (1.0.7 / 3.2.0) — four preset levels applied by
 * setting the document root font size. Tailwind sizes are rem-based, so
 * this scales the whole interface proportionally. Independent of the
 * per-reader font size.
 */

export type FontScale = 'small' | 'standard' | 'large' | 'xlarge'

export const FONT_SCALE_OPTIONS: Array<{ key: FontScale; label: string; px: number }> = [
  { key: 'small', label: '小', px: 15 },
  { key: 'standard', label: '标准', px: 16 },
  { key: 'large', label: '大', px: 18 },
  { key: 'xlarge', label: '超大', px: 20 }
]

const STORAGE_KEY = 'sophia.fontScale'

export function getFontScale(): FontScale {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as FontScale | null
    return FONT_SCALE_OPTIONS.some((o) => o.key === v) ? (v as FontScale) : 'standard'
  } catch {
    return 'standard'
  }
}

export function applyFontScale(scale?: FontScale): void {
  const s = scale ?? getFontScale()
  const px = FONT_SCALE_OPTIONS.find((o) => o.key === s)?.px ?? 16
  document.documentElement.style.fontSize = `${px}px`
}

export function setFontScale(scale: FontScale): void {
  try {
    localStorage.setItem(STORAGE_KEY, scale)
  } catch {
    // storage disabled — best-effort
  }
  applyFontScale(scale)
}
