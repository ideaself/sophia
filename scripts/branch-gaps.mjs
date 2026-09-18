/**
 * Branch-gap helper: lists uncovered branch locations for the given source
 * files using the JSON coverage report.
 *
 * Usage:
 *   npm run test:coverage -- --coverage.reporter=json \
 *     --coverage.reportsDirectory=./coverage-json --coverage.reporter=text
 *   node scripts/branch-gaps.mjs coverage-json/coverage-final.json ClassroomView.tsx
 */
import { readFileSync } from 'node:fs'

const [, , reportPath = 'coverage-json/coverage-final.json', ...suffixes] = process.argv

const cov = JSON.parse(readFileSync(reportPath, 'utf8'))
const wanted = suffixes.map((s) => s.replace(/\\/g, '/'))

for (const suffix of wanted) {
  const matches = Object.entries(cov).filter(([f]) =>
    f.replace(/\\/g, '/').endsWith(suffix)
  )
  if (matches.length === 0) {
    console.log('MISSING', suffix)
    continue
  }
  for (const [file, data] of matches.slice(0, 1)) {
    const src = readFileSync(file, 'utf8').split(/\r?\n/)
    const byLine = new Map()
    for (const [k, counts] of Object.entries(data.b)) {
      const meta = data.branchMap[k]
      counts.forEach((count, i) => {
        if (count !== 0) return
        const line = meta.locations?.[i]?.start?.line ?? meta.line ?? meta.loc?.start?.line
        byLine.set(line, (byLine.get(line) ?? 0) + 1)
      })
    }
    const lines = [...byLine.keys()].sort((a, b) => a - b)
    const total = [...byLine.values()].reduce((a, b) => a + b, 0)
    console.log(`== ${suffix} (${lines.length} lines, ${total} branches)`)
    for (const line of lines) {
      console.log(`  ${line}: ${(src[line - 1] || '').trim().slice(0, 120)}`)
    }
  }
}
