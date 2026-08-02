/**
 * Online dictionary configuration (词典查词).
 *
 * The user can customize the dictionary URL template in settings; `{word}`
 * is replaced with the selected English word. Defaults to Youdao.
 */

export const DEFAULT_DICT_TEMPLATE = 'https://dict.youdao.com/result?word={word}&lang=en'

export interface DictConfig {
  /** Master switch — auto popup on English word selection. */
  enabled: boolean
  /** URL template containing a `{word}` placeholder. */
  template: string
}

const ENABLED_KEY = 'sophia.dictEnabled'
const TEMPLATE_KEY = 'sophia.dictTemplate'

export function loadDictConfig(): DictConfig {
  let enabled = true
  let template = DEFAULT_DICT_TEMPLATE
  try {
    const e = localStorage.getItem(ENABLED_KEY)
    if (e !== null) enabled = e === '1'
    const t = localStorage.getItem(TEMPLATE_KEY)
    if (t && t.trim()) template = t.trim()
  } catch {
    // storage disabled — defaults
  }
  return { enabled, template }
}

export function saveDictConfig(config: DictConfig): void {
  try {
    localStorage.setItem(ENABLED_KEY, config.enabled ? '1' : '0')
    localStorage.setItem(TEMPLATE_KEY, config.template.trim())
  } catch {
    // best-effort
  }
}

/** Replace the `{word}` placeholder with the URL-encoded word. */
export function buildDictUrl(template: string, word: string): string {
  const safeTemplate = template && template.includes('{word}')
    ? template
    : DEFAULT_DICT_TEMPLATE
  return safeTemplate.replace('{word}', encodeURIComponent(word.trim()))
}

/**
 * True when the selected text looks like a single English word worth looking
 * up: letters (with optional apostrophes/hyphens), 1–64 chars, no spaces.
 */
export function isEnglishWord(text: string): boolean {
  const t = text.trim()
  return /^[A-Za-z][A-Za-z'-]{0,63}$/.test(t)
}
