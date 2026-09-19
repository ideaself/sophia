/**
 * 概念间隔复习（SM-2 变体，与记忆卡片同一算法与评分档）：
 * 概念掌握度回答「学得怎么样」，SRS 回答「什么时候该再复习」。
 * 纯函数，主进程与测试共用。
 */

export type ConceptRating = 'again' | 'hard' | 'good' | 'easy'

export interface ConceptSrsState {
  /** 当前间隔（天）。 */
  interval: number
  ease: number
  reps: number
  /** 下次复习时间戳（ms）。 */
  nextReview: number
  /** 上次复习时间戳（ms），0 表示从未复习。 */
  lastReview: number
}

export const SRS_DAY_MS = 86_400_000

/** 新概念默认 1 天后首次复习。 */
export function newConceptSrs(now: number): ConceptSrsState {
  return { interval: 0, ease: 2.5, reps: 0, nextReview: now + SRS_DAY_MS, lastReview: 0 }
}

function qualityOf(rating: ConceptRating): number {
  return { again: 0, hard: 3, good: 4, easy: 5 }[rating]
}

/** 按评分推进 SM-2 状态（again 重置为 1 天，其余按间隔递进）。 */
export function updateConceptSrs(
  state: ConceptSrsState,
  rating: ConceptRating,
  now: number
): ConceptSrsState {
  const q = qualityOf(rating)

  if (q < 3) {
    return {
      interval: 1,
      ease: Math.max(1.3, state.ease - 0.2),
      reps: 0,
      nextReview: now + SRS_DAY_MS,
      lastReview: now
    }
  }

  const reps = state.reps + 1
  let interval: number
  if (reps === 1) {
    interval = rating === 'easy' ? 4 : 1
  } else if (reps === 2) {
    interval = rating === 'easy' ? 8 : 3
  } else {
    interval = Math.round(state.interval * state.ease)
  }

  const ease = Math.max(1.3, state.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))

  return {
    interval,
    ease,
    reps,
    nextReview: now + interval * SRS_DAY_MS,
    lastReview: now
  }
}

/** 是否到期（无排期视为到期）。 */
export function isConceptDue(srs: ConceptSrsState | undefined, now: number): boolean {
  if (!srs) return true
  return srs.nextReview <= now
}

/** 「下次复习」展示文案。 */
export function nextReviewLabel(srs: ConceptSrsState, now: number): string {
  const days = Math.ceil((srs.nextReview - now) / SRS_DAY_MS)
  if (days <= 0) return '今天'
  if (days === 1) return '明天'
  return `${days} 天后`
}
