/**
 * Quick text templates (1.0.7) — up to 9 reusable text snippets the learner
 * can insert into the classroom input via a button or Alt+1..9.
 * Stored in localStorage (renderer-only).
 */

export const MAX_TEXT_TEMPLATES = 9
export const MAX_TEMPLATE_LENGTH = 120

const STORAGE_KEY = 'sophia.textTemplates'

export function loadTextTemplates(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, MAX_TEXT_TEMPLATES)
  } catch {
    return []
  }
}

export function saveTextTemplates(templates: string[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(templates.slice(0, MAX_TEXT_TEMPLATES))
    )
  } catch {
    // storage disabled / quota — best-effort
  }
}
