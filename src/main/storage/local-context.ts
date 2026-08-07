import { readFile } from 'node:fs/promises'
import { learnerPath } from './app-data'
import { isNotFoundError, warnReadFailure } from './fs-errors'

export interface LocalContext {
  learnerProfile: string
}

/**
 * Read the single-user local context: learner.md straight from the data
 * root — the learner profile is the whole context.
 */
export async function readLocalContext(
  dataRoot: string
): Promise<LocalContext | null> {
  try {
    let learnerProfile = ''
    try {
      learnerProfile = await readFile(learnerPath(dataRoot), 'utf-8')
    } catch {
      // learner.md is optional
    }

    return { learnerProfile }
  } catch (err) {
    if (!isNotFoundError(err)) warnReadFailure('local context', err)
    return null
  }
}
