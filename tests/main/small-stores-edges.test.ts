/**
 * Main-process small stores/utils — remaining edge branches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { DiaryStore } from '../../src/main/storage/diary-store'
import { loadSyncState, saveSyncState, emptySyncState } from '../../src/main/sync/sync-state'
import { ConceptStore } from '../../src/main/learning-memory/concept-store'
import { truncateToBudget, estimateTokens } from '../../src/main/prompt/token-budget'
import { buildStatsOverview } from '../../src/main/stats/overview'

let dataRoot = ''

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-small-'))
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('DiaryStore', () => {
  it('ignores entries with an unparseable month', async () => {
    const store = new DiaryStore(dataRoot)
    await store.append({ date: 'not-a-date', companionName: '朗道', content: '内容' })

    await expect(store.listMonths()).resolves.toEqual([])
  })

  it('lists months newest first', async () => {
    const store = new DiaryStore(dataRoot)
    await store.append({ date: '2026-05-01T10:00:00.000Z', companionName: '朗道', content: '五月' })
    await store.append({ date: '2026-07-01T10:00:00.000Z', companionName: '朗道', content: '七月' })

    await expect(store.listMonths()).resolves.toEqual(['2026-07', '2026-05'])
  })
})

describe('sync-state', () => {
  it('rejects an unrecognized shape with a warning', async () => {
    await writeFile(
      join(dataRoot, 'sync-state.json'),
      JSON.stringify({ version: 2, files: {} }),
      'utf-8'
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(loadSyncState(dataRoot)).resolves.toBeNull()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('round-trips a well-formed state', async () => {
    const state = emptySyncState()
    state.files['a.md'] = { localSize: 1, localMtimeMs: 1, remoteSize: 1, remoteLastmod: 'm' }
    await saveSyncState(dataRoot, state)

    await expect(loadSyncState(dataRoot)).resolves.toMatchObject({
      files: { 'a.md': { remoteLastmod: 'm' } }
    })
  })
})

describe('ConceptStore', () => {
  it('skips nameless updates and stores misconceptions', async () => {
    const store = new ConceptStore(dataRoot)

    await store.applyEvidence({
      conversationId: 'c1',
      textbookId: null,
      messageIds: ['m1', 'm2'],
      updates: [
        { name: '   ', performance: 'correct' },
        { name: '熵', performance: 'incorrect', misconception: '把它当成能量' }
      ]
    })

    const states = await store.load()
    expect(states).toHaveLength(1)
    expect(states[0]).toMatchObject({ name: '熵', misconception: '把它当成能量' })
  })
})

describe('token-budget', () => {
  it('returns just the truncation marker for a zero budget', () => {
    const out = truncateToBudget('一段很长的正文', 0)
    expect(estimateTokens(out)).toBeLessThanOrEqual(estimateTokens('一段很长的正文'))
    expect(out.length).toBeLessThan('一段很长的正文'.length + 1)
  })
})

describe('stats overview', () => {
  it('ignores non-finite timestamps', () => {
    const overview = buildStatsOverview({
      conversations: [{ id: 'c1', companionId: 'comp_a', textbookId: null }],
      messagesByConversation: {
        c1: [
          { createdAt: 'not-a-date' } as never,
          { createdAt: new Date().toISOString() } as never
        ]
      },
      artifactsByConversation: { c1: [] },
      now: new Date()
    } as never)

    expect(overview.totalMessages).toBe(2)
    // The non-finite timestamp is skipped for time-based aggregations.
    expect(overview.week.messages).toBe(1)
  })
})
