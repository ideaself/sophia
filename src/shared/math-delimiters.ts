/**
 * LaTeX math delimiter normalization.
 *
 * remark-math only recognizes `$...$` / `$$...$$`; the `\(...\)` / `\[...\]`
 * delimiters (standard LaTeX math mode, commonly emitted by LLMs and pasted
 * by learners) are treated as plain text and never rendered. Normalize them
 * to dollar delimiters before the markdown pipeline sees the text.
 */

/**
 * Convert `\(...\)` → `$...$` and `\[...\]` → `$$...$$`.
 * Existing dollar-delimited math is left untouched.
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown || !markdown.includes('\\')) return markdown
  return markdown
    .replace(/\\\[/g, '$$$$') // \[ → $$
    .replace(/\\\]/g, '$$$$') // \] → $$
    .replace(/\\\(/g, '$')    // \( → $
    .replace(/\\\)/g, '$')    // \) → $
}
