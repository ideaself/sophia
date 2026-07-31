/**
 * Reading-note rendering helpers (framework-free, testable).
 *
 * Notes store the exact selected text; when a chapter is rendered we wrap
 * the first occurrence of that text so highlights / underlines survive
 * reloads. Matching the first occurrence is a documented v1 limitation for
 * repeated phrases.
 */

export interface NoteLike {
  id: string
  position: string
  type: string
  content: string
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function applyNotesToHtml(
  html: string,
  allNotes: NoteLike[],
  chapterIdx: number
): string {
  let out = html
  for (const note of allNotes) {
    if (note.position !== String(chapterIdx)) continue
    if (note.type !== 'highlight' && note.type !== 'underline' && note.type !== 'note') continue
    const needle = escapeHtml(note.content).trim()
    if (!needle) continue
    const idx = out.indexOf(needle)
    if (idx === -1) continue
    const tag = note.type === 'underline' ? 'u' : 'mark'
    const style =
      note.type === 'underline'
        ? ' style="text-decoration:underline;text-decoration-color:#4ade80;text-decoration-thickness:2px"'
        : ' style="background-color:rgba(255,213,79,0.45)"'
    out =
      out.slice(0, idx) +
      `<${tag} data-note="${note.id}"${style}>` +
      needle +
      `</${tag}>` +
      out.slice(idx + needle.length)
  }
  return out
}
