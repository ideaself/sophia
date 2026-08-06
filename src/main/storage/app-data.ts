import { join } from 'node:path'

/**
 * Path resolution helpers for the local data layout.
 *
 * Layout:
 *   {dataRoot}/
 *     config/
 *     profiles/
 *       {profileId}/
 *         profile.json
 *         worlds/
 *           {worldId}/
 *             world.json
 *             story.md
 *             learner.md
 *             companions/
 *               index.json
 *               *.md
 */

export const DEFAULT_PROFILE_ID = 'prof_default'
export const DEFAULT_PROFILE_NAME = 'Default'
export const DEFAULT_WORLD_ID = 'world_default'
export const DEFAULT_WORLD_NAME = '苏格拉底实验室'

export function profileDir(dataRoot: string, profileId: string = DEFAULT_PROFILE_ID): string {
  return join(dataRoot, 'profiles', profileId)
}

export function profilePath(dataRoot: string, profileId: string = DEFAULT_PROFILE_ID): string {
  return join(profileDir(dataRoot, profileId), 'profile.json')
}

export function worldDir(
  dataRoot: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(profileDir(dataRoot, profileId), 'worlds', worldId)
}

export function worldPath(
  dataRoot: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(worldDir(dataRoot, worldId, profileId), 'world.json')
}

export function storyPath(
  dataRoot: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(worldDir(dataRoot, worldId, profileId), 'story.md')
}

export function learnerPath(
  dataRoot: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(worldDir(dataRoot, worldId, profileId), 'learner.md')
}

export function palMomentsPath(
  dataRoot: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(worldDir(dataRoot, worldId, profileId), 'pal_moments.md')
}

/**
 * 按教材隔离的教学互动备忘文件：有教材的课堂读写
 * pal_moments_{textbookId}.md，无教材课堂读写全局 pal_moments.md。
 * 避免上一门课（如傅里叶光学）的互动内容串进新教材（微积分）课堂。
 */
export function palMomentsPathForTextbook(
  dataRoot: string,
  textbookId: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(worldDir(dataRoot, worldId, profileId), `pal_moments_${textbookId}.md`)
}

export function relationPath(
  dataRoot: string,
  companionId: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(worldDir(dataRoot, worldId, profileId), `relation_${companionId}.md`)
}

export function handoffMetaPath(
  dataRoot: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(worldDir(dataRoot, worldId, profileId), 'handoff_meta.json')
}

export function diaryDir(
  dataRoot: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(worldDir(dataRoot, worldId, profileId), 'diary')
}

export function diaryPath(
  dataRoot: string,
  month: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  // month is expected as "YYYY-MM"; sanitize to prevent path traversal.
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : 'unknown'
  return join(diaryDir(dataRoot, worldId, profileId), `${safeMonth}.md`)
}

export function companionDir(
  dataRoot: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(worldDir(dataRoot, worldId, profileId), 'companions')
}

export function configDir(dataRoot: string): string {
  return join(dataRoot, 'config')
}

// --- Textbook paths ---

export function textbooksDir(
  dataRoot: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(worldDir(dataRoot, worldId, profileId), 'textbooks')
}

export function textbookDir(
  dataRoot: string,
  textbookId: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(textbooksDir(dataRoot, worldId, profileId), textbookId)
}

export function textbookPath(
  dataRoot: string,
  textbookId: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(textbookDir(dataRoot, textbookId, worldId, profileId), 'textbook.json')
}

export function textbookContentPath(
  dataRoot: string,
  textbookId: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(textbookDir(dataRoot, textbookId, worldId, profileId), 'source.md')
}

export function textbookOriginalPath(
  dataRoot: string,
  textbookId: string,
  formatOrFileName: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  // If the caller passes a full filename (e.g. "my-book.pdf"), use it directly.
  // Otherwise treat it as a format and derive the extension.
  const hasExt = /\.[a-z0-9]+$/i.test(formatOrFileName)
  const fileName = hasExt
    ? formatOrFileName
    : `source.${formatOrFileName === 'epub' ? 'epub' : 'pdf'}`
  return join(textbookDir(dataRoot, textbookId, worldId, profileId), fileName)
}

export function textbookNotesDir(
  dataRoot: string,
  textbookId: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(textbookDir(dataRoot, textbookId, worldId, profileId), 'notes')
}

// --- Conversation paths ---

export function conversationsDir(
  dataRoot: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(worldDir(dataRoot, worldId, profileId), 'conversations')
}

export function conversationDir(
  dataRoot: string,
  conversationId: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(conversationsDir(dataRoot, worldId, profileId), conversationId)
}

export function conversationPath(
  dataRoot: string,
  conversationId: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(conversationDir(dataRoot, conversationId, worldId, profileId), 'conversation.json')
}

export function conversationMessagesPath(
  dataRoot: string,
  conversationId: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(conversationDir(dataRoot, conversationId, worldId, profileId), 'messages.json')
}

// --- Artifact paths ---

export function artifactsDir(
  dataRoot: string,
  conversationId: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(conversationDir(dataRoot, conversationId, worldId, profileId), 'artifacts')
}

export function artifactPath(
  dataRoot: string,
  conversationId: string,
  artifactId: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(artifactsDir(dataRoot, conversationId, worldId, profileId), `${artifactId}.json`)
}
