/**
 * DiaryStore — monthly diary aggregation.
 *
 * Diary artifacts are also written into per-month markdown files under
 * `{world}/diary/YYYY-MM.md` so the learner can browse their diary as a
 * timeline.  Each entry uses the reference layout:
 *
 *   ## YYYY-MM-DD | 伙伴名
 *
 *   (diary content)
 *
 *   ---
 *
 * Entries are appended chronologically; a single `---` separator divides
 * them.  Files that don't exist yet are created on first append.
 */

import { mkdir, readFile, appendFile, readdir } from 'node:fs/promises'
import { diaryDir, diaryPath } from './app-data'

export interface DiaryEntryInput {
  /** ISO date string (or any string with a leading YYYY-MM-DD). */
  date: string
  /** Companion display name for the entry heading. */
  companionName: string
  /** Diary body (Markdown). */
  content: string
}

export class DiaryStore {
  constructor(private readonly dataRoot: string) {}

  /**
   * Append one diary entry to the monthly file for the entry's date.
   */
  async append(entry: DiaryEntryInput): Promise<void> {
    const month = monthOf(entry.date)
    if (!month) return

    const filePath = diaryPath(this.dataRoot, month)
    const day = entry.date.slice(0, 10)
    const heading = `## ${day} | ${entry.companionName}`
    const body = entry.content.trim()

    const block = body
      ? [heading, '', body, '', '---', ''].join('\n')
      : [heading, '', '---', ''].join('\n')

    await mkdir(diaryDir(this.dataRoot), { recursive: true })
    await appendFile(filePath, block, 'utf-8')
  }

  /**
   * List available month files (newest first), e.g. ["2026-07", "2026-06"].
   */
  async listMonths(): Promise<string[]> {
    try {
      const dir = diaryDir(this.dataRoot)
      const entries = await readdir(dir)
      const months = entries
        .filter((name) => /^\d{4}-\d{2}\.md$/.test(name))
        .map((name) => name.slice(0, 7))
        .sort((a, b) => b.localeCompare(a))
      return months
    } catch {
      return []
    }
  }

  /**
   * Read the raw markdown for one month (e.g. "2026-07").
   * Returns null when the month has no diary file.
   */
  async getMonth(month: string): Promise<string | null> {
    try {
      const raw = await readFile(diaryPath(this.dataRoot, month), 'utf-8')
      return raw
    } catch {
      return null
    }
  }
}

/** Extract "YYYY-MM" from an ISO timestamp. Returns null when unparseable. */
function monthOf(iso: string): string | null {
  const match = /^(\d{4}-\d{2})/.exec(iso)
  return match ? match[1] : null
}