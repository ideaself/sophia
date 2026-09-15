/**
 * Remove build/report artifacts. Cross-platform equivalent of
 * `rm -rf out release coverage` (the release/ dir alone can reach ~750 MB).
 */
import { rmSync } from 'node:fs'

for (const dir of ['out', 'release', 'coverage']) {
  rmSync(dir, { recursive: true, force: true })
}

console.log('Cleaned: out/ release/ coverage/')
