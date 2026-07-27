import { readFile } from 'node:fs/promises'
import type { World } from '../../shared/schemas/world'
import { WorldSchema } from '../../shared/schemas/world'
import type { WorldId, ProfileId } from '../../shared/types/ids'
import {
  worldPath,
  storyPath,
  learnerPath,
  DEFAULT_WORLD_ID,
  DEFAULT_PROFILE_ID
} from './app-data'

export interface WorldData {
  world: World
  story: string
  learnerProfile: string
}

/**
 * Read world data (world.json + story.md + learner.md) from disk.
 * Returns null if world.json doesn't exist.
 */
export async function readWorldData(
  dataRoot: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): Promise<WorldData | null> {
  try {
    const raw = await readFile(worldPath(dataRoot, worldId, profileId), 'utf-8')
    const world = WorldSchema.parse(JSON.parse(raw)) as unknown as World

    let story = ''
    try {
      story = await readFile(storyPath(dataRoot, worldId, profileId), 'utf-8')
    } catch {
      // story.md is optional
    }

    let learnerProfile = ''
    try {
      learnerProfile = await readFile(learnerPath(dataRoot, worldId, profileId), 'utf-8')
    } catch {
      // learner.md is optional
    }

    return { world, story, learnerProfile }
  } catch {
    return null
  }
}
