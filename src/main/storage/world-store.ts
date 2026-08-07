import { readFile } from 'node:fs/promises'
import { storyPath, learnerPath, DEFAULT_WORLD_ID, DEFAULT_PROFILE_ID } from './app-data'
import { isNotFoundError, warnReadFailure } from './fs-errors'

export interface LocalContext {
  story: string
  learnerProfile: string
}

/**
 * Read the single-user local context: story.md + learner.md straight from
 * the data root. No world/profile layers — these two markdown files are the
 * whole world context.
 */
export async function readLocalContext(
  dataRoot: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): Promise<LocalContext | null> {
  try {
    let story = ''
    try {
      story = await readFile(storyPath(dataRoot), 'utf-8')
    } catch {
      // story.md is optional
    }

    let learnerProfile = ''
    try {
      learnerProfile = await readFile(learnerPath(dataRoot), 'utf-8')
    } catch {
      // learner.md is optional
    }

    return { story, learnerProfile }
  } catch (err) {
    if (!isNotFoundError(err)) warnReadFailure('local context', err)
    return null
  }
}
