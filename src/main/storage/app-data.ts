import { join } from 'node:path'

/**
 * Path resolution helpers for the local data layout.
 *
 * Layout (single user, no profile/world layers):
 *   {dataRoot}/
 *     config/
 *     companions/
 *     textbooks/
 *     conversations/
 *     diary/
 *     story.md
 *     learner.md
 *     pal_moments.md
 *     handoff_meta.json
 */

export const DEFAULT_PROFILE_ID = 'prof_default'
export const DEFAULT_WORLD_ID = 'world_default'

export function worldDir(
  dataRoot: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return dataRoot
}

export function storyPath(
  dataRoot: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(dataRoot, 'story.md')
}

export function learnerPath(
  dataRoot: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(dataRoot, 'learner.md')
}

export function palMomentsPath(
  dataRoot: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(dataRoot, 'pal_moments.md')
}

/**
 * 按教材隔离的教学互动备忘文件：有教材的课堂读写
 * pal_moments_{textbookId}.md，无教材课堂读写全局 pal_moments.md。
 * 避免上一门课（如傅里叶光学）的互动内容串进新教材（微积分）课堂。
 */
export function palMomentsPathForTextbook(
  dataRoot: string,
  textbookId: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(dataRoot, `pal_moments_${textbookId}.md`)
}

export function relationPath(
  dataRoot: string,
  companionId: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(dataRoot, `relation_${companionId}.md`)
}

export function handoffMetaPath(
  dataRoot: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(dataRoot, 'handoff_meta.json')
}

export function diaryDir(
  dataRoot: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(dataRoot, 'diary')
}

export function diaryPath(
  dataRoot: string,
  month: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  // month is expected as "YYYY-MM"; sanitize to prevent path traversal.
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : 'unknown'
  return join(diaryDir(dataRoot), `${safeMonth}.md`)
}

export function companionDir(
  dataRoot: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(dataRoot, 'companions')
}

export function configDir(dataRoot: string): string {
  return join(dataRoot, 'config')
}

// --- Textbook paths ---

export function textbooksDir(
  dataRoot: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(dataRoot, 'textbooks')
}

export function textbookDir(
  dataRoot: string,
  textbookId: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(textbooksDir(dataRoot), textbookId)
}

export function textbookPath(
  dataRoot: string,
  textbookId: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(textbookDir(dataRoot, textbookId), 'textbook.json')
}

export function textbookContentPath(
  dataRoot: string,
  textbookId: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(textbookDir(dataRoot, textbookId), 'source.md')
}

export function textbookOriginalPath(
  dataRoot: string,
  textbookId: string,
  formatOrFileName: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  // If the caller passes a full filename (e.g. "my-book.pdf"), use it directly.
  // Otherwise treat it as a format and derive the extension.
  const hasExt = /\.[a-z0-9]+$/i.test(formatOrFileName)
  const fileName = hasExt
    ? formatOrFileName
    : `source.${formatOrFileName === 'epub' ? 'epub' : 'pdf'}`
  return join(textbookDir(dataRoot, textbookId), fileName)
}

export function textbookNotesDir(
  dataRoot: string,
  textbookId: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(textbookDir(dataRoot, textbookId), 'notes')
}

// --- Conversation paths ---

export function conversationsDir(
  dataRoot: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(dataRoot, 'conversations')
}

export function conversationDir(
  dataRoot: string,
  conversationId: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(conversationsDir(dataRoot), conversationId)
}

export function conversationPath(
  dataRoot: string,
  conversationId: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(conversationDir(dataRoot, conversationId), 'conversation.json')
}

export function conversationMessagesPath(
  dataRoot: string,
  conversationId: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(conversationDir(dataRoot, conversationId), 'messages.json')
}

// --- Artifact paths ---

export function artifactsDir(
  dataRoot: string,
  conversationId: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(conversationDir(dataRoot, conversationId), 'artifacts')
}

export function artifactPath(
  dataRoot: string,
  conversationId: string,
  artifactId: string,
  _worldId: string = DEFAULT_WORLD_ID,
  _profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(artifactsDir(dataRoot, conversationId), `${artifactId}.json`)
}
