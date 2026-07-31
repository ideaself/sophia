/**
 * Self-test question parsing (framework-free, testable).
 *
 * Lesson summaries generated at end of class may contain self-test questions
 * in this format:
 *   **自测 1：<问题>**
 *   - 提示 1：<线索>
 *   - 提示 2：<更接近答案的线索>
 *   - 答案：<完整答案>
 */

export interface SelfTestQuestion {
  question: string
  hints: string[]
  answer: string
}

const QUESTION_RE = /^[-*]?\s*\*{0,2}自测\s*\d*\s*[：:]\s*(.+?)\*{0,2}\s*$/
const FIELD_RE = /^[-*]?\s*\*{0,2}(?:提示\s*(\d+)|答案)\s*[：:]\s*(.+?)\*{0,2}\s*$/

export function parseSelfTestQuestions(content: string): SelfTestQuestion[] {
  const questions: SelfTestQuestion[] = []
  let current: { question: string; hints: string[]; answer: string } | null = null

  const pushCurrent = () => {
    if (current && current.question && current.answer) {
      questions.push({
        question: current.question,
        hints: current.hints.filter((h) => h.trim().length > 0),
        answer: current.answer
      })
    }
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    const qm = QUESTION_RE.exec(line)
    if (qm) {
      pushCurrent()
      current = { question: qm[1].trim(), hints: [], answer: '' }
      continue
    }

    if (current) {
      const fm = FIELD_RE.exec(line)
      if (fm) {
        if (fm[1]) {
          const n = parseInt(fm[1], 10)
          current.hints[n - 1] = fm[2].trim()
        } else {
          current.answer = fm[2].trim()
        }
        continue
      }
      // Indented continuation lines extend the most recent field. Non-indented
      // lines end the current block (e.g. trailing prose after the questions).
      if (line && (rawLine.startsWith(' ') || rawLine.startsWith('\t'))) {
        if (current.answer) {
          current.answer += '\n' + line
        } else if (current.hints.length > 0) {
          current.hints[current.hints.length - 1] += '\n' + line
        }
      }
    }
  }
  pushCurrent()
  return questions
}
