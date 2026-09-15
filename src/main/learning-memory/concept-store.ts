import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isNotFoundError } from '../storage/fs-errors'
import { atomicWriteFile } from '../storage/atomic-write'

export type ConceptPerformance = 'correct' | 'partial' | 'incorrect' | 'unclear'

export interface ConceptState {
  id: string
  name: string
  textbookId: string | null
  /** 0-1 掌握度（EMA 更新）。 */
  mastery: number
  misconception: string | null
  attemptCount: number
  correctCount: number
  lastSeenAt: string
  updatedAt: string
  /** 最近一次接触该概念的会话（复盘页按会话过滤展示）。 */
  evidenceConversationId: string
  /**
   * 曾接触过该概念的全部会话。单值字段只保留"最近一次"，会导致概念在
   * 其他会话被再次命中后从原会话的复盘页消失。
   */
  evidenceConversationIds?: string[]
  /** 证据消息 ID —— 可溯源"这条掌握度来自哪次对话"。 */
  evidenceMessageIds: string[]
}

export interface ConceptEvidenceUpdate {
  name: string
  performance: ConceptPerformance
  misconception?: string
}

export interface ConceptEvidence {
  conversationId: string
  textbookId: string | null
  messageIds: string[]
  updates: ConceptEvidenceUpdate[]
}

// EMA 参数：答对 / 部分答对 / 答错的更新幅度
const CORRECT_ALPHA = 0.2
const PARTIAL_ALPHA = 0.1
const INCORRECT_PENALTY = 0.25
const INITIAL_MASTERY = 0.5

/** 概念 id 由名称稳定生成（同名概念跨会话合并）。 */
function conceptId(name: string): string {
  let h = 5381
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0
  }
  return `concept_${(h >>> 0).toString(36)}`
}

/**
 * 学习概念掌握度存储（Kimi 方案：对话中增量识别，概念级掌握度 +
 * 误解点 + 证据溯源）。数据落在 {dataRoot}/concepts.json。
 */
export class ConceptStore {
  constructor(private readonly dataRoot: string) {}

  /**
   * Serializes read-modify-write cycles. Two concurrent applyEvidence calls
   * would otherwise both load the same snapshot and overwrite each other,
   * losing one side's mastery updates.
   */
  private writeChain: Promise<unknown> = Promise.resolve()

  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(task, task)
    // Keep the chain alive after a failed write so later writes still queue.
    this.writeChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private get filePath(): string {
    return join(this.dataRoot, 'concepts.json')
  }

  async load(): Promise<ConceptState[]> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed as ConceptState[] : []
    } catch (err) {
      if (!isNotFoundError(err)) console.warn('Failed to load concepts:', err)
      return []
    }
  }

  async listByConversation(conversationId: string): Promise<ConceptState[]> {
    const all = await this.load()
    return all.filter(
      (c) =>
        c.evidenceConversationId === conversationId ||
        (Array.isArray(c.evidenceConversationIds) &&
          c.evidenceConversationIds.includes(conversationId))
    )
  }

  /**
   * 应用一次对话证据：按 名称+教材 合并概念，EMA 更新掌握度。
   * 返回全部概念（供事件推送后刷新）。
   */
  async applyEvidence(evidence: ConceptEvidence): Promise<ConceptState[]> {
    // Serialize: read-modify-write must not interleave with other writers.
    return this.enqueueWrite(() => this.applyEvidenceLocked(evidence))
  }

  private async applyEvidenceLocked(evidence: ConceptEvidence): Promise<ConceptState[]> {
    const states = await this.load()
    const now = new Date().toISOString()
    const msgIds = evidence.messageIds

    for (const u of evidence.updates) {
      const name = u.name.trim()
      if (!name) continue
      const id = conceptId(name)
      let s = states.find((c) => c.id === id && c.textbookId === evidence.textbookId)
      if (!s) {
        s = {
          id,
          name,
          textbookId: evidence.textbookId,
          mastery: INITIAL_MASTERY,
          misconception: null,
          attemptCount: 0,
          correctCount: 0,
          lastSeenAt: now,
          updatedAt: now,
          evidenceConversationId: evidence.conversationId,
          evidenceConversationIds: [evidence.conversationId],
          evidenceMessageIds: msgIds
        }
        states.push(s)
      }

      if (u.performance !== 'unclear') {
        s.attemptCount += 1
      }
      s.lastSeenAt = now
      s.updatedAt = now
      const priorConversations = s.evidenceConversationIds ?? [s.evidenceConversationId]
      s.evidenceConversationId = evidence.conversationId
      s.evidenceConversationIds = [...new Set([...priorConversations, evidence.conversationId])]
      s.evidenceMessageIds = [...new Set([...s.evidenceMessageIds, ...msgIds])]

      switch (u.performance) {
        case 'correct':
          s.mastery = Math.min(1, s.mastery + CORRECT_ALPHA * (1 - s.mastery))
          s.correctCount += 1
          if (s.misconception) s.misconception = null
          break
        case 'partial':
          s.mastery = Math.min(1, s.mastery + PARTIAL_ALPHA * (1 - s.mastery))
          if (u.misconception) s.misconception = u.misconception
          break
        case 'incorrect':
          s.mastery = Math.max(0.05, s.mastery - INCORRECT_PENALTY * s.mastery)
          if (u.misconception) s.misconception = u.misconception
          break
        case 'unclear':
          // 学习者提出但尚未作答的问题：仅标记接触，不改变掌握度
          break
      }
    }

    await mkdir(this.dataRoot, { recursive: true })
    // Atomic write: a crash mid-save must not truncate concepts.json.
    await atomicWriteFile(this.filePath, JSON.stringify(states, null, 2), 'utf-8')
    return states
  }
}
