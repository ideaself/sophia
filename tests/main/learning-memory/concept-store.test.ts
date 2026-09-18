import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ConceptStore, type ConceptEvidence } from '../../../src/main/learning-memory/concept-store'
import { parseUpdates } from '../../../src/main/learning-memory/concept-extractor'

let dataRoot: string
let store: ConceptStore

function evidence(partial: Partial<ConceptEvidence>): ConceptEvidence {
  return {
    conversationId: 'conv_a',
    textbookId: null,
    messageIds: ['m1', 'm2'],
    updates: [],
    ...partial
  }
}

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-concepts-'))
  store = new ConceptStore(dataRoot)
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

describe('ConceptStore.applyEvidence', () => {
  it('首次接触创建概念，初始掌握度 0.5', async () => {
    await store.applyEvidence(evidence({ updates: [{ name: '欧拉公式', performance: 'unclear' }] }))
    const all = await store.load()
    expect(all).toHaveLength(1)
    expect(all[0].mastery).toBe(0.5)
    // unclear 未作答：不计入尝试次数
    expect(all[0].attemptCount).toBe(0)
    expect(all[0].evidenceMessageIds).toEqual(['m1', 'm2'])
  })

  it('答对提升掌握度（EMA），答错下降并记录误解点', async () => {
    await store.applyEvidence(evidence({ updates: [{ name: '卷积', performance: 'incorrect', misconception: '把卷积当逐点相乘' }] }))
    const afterWrong = (await store.load())[0]
    expect(afterWrong.mastery).toBeLessThan(0.5)
    expect(afterWrong.misconception).toBe('把卷积当逐点相乘')

    await store.applyEvidence(evidence({ conversationId: 'conv_a', messageIds: ['m3', 'm4'], updates: [{ name: '卷积', performance: 'correct' }] }))
    const afterCorrect = (await store.load())[0]
    expect(afterCorrect.mastery).toBeGreaterThan(afterWrong.mastery)
    expect(afterCorrect.attemptCount).toBe(2)
    expect(afterCorrect.correctCount).toBe(1)
    // 答对后误解点清除
    expect(afterCorrect.misconception).toBeNull()
  })

  it('同名概念跨会话合并（按名称+教材）', async () => {
    await store.applyEvidence(evidence({ conversationId: 'conv_a', updates: [{ name: '傅里叶变换', performance: 'correct' }] }))
    await store.applyEvidence(evidence({ conversationId: 'conv_b', updates: [{ name: '傅里叶变换', performance: 'incorrect' }] }))
    const all = await store.load()
    expect(all).toHaveLength(1)
    expect(all[0].attemptCount).toBe(2)
    // 证据会话更新为最近一次
    expect(all[0].evidenceConversationId).toBe('conv_b')
  })

  it('不同教材的同名概念分开记录', async () => {
    await store.applyEvidence(evidence({ textbookId: 'tb_a', updates: [{ name: '矩阵', performance: 'correct' }] }))
    await store.applyEvidence(evidence({ textbookId: 'tb_b', updates: [{ name: '矩阵', performance: 'incorrect' }] }))
    expect((await store.load()).length).toBe(2)
  })

  it('listByConversation 只返回该会话接触的概念', async () => {
    await store.applyEvidence(evidence({ conversationId: 'conv_a', updates: [{ name: 'A', performance: 'correct' }] }))
    await store.applyEvidence(evidence({ conversationId: 'conv_b', updates: [{ name: 'B', performance: 'correct' }] }))
    const list = await store.listByConversation('conv_a')
    expect(list.map((c) => c.name)).toEqual(['A'])
  })

  it('概念在其他会话被再次命中后，仍归属于原会话的复盘页', async () => {
    await store.applyEvidence(evidence({ conversationId: 'conv_a', updates: [{ name: '傅里叶变换', performance: 'correct' }] }))
    await store.applyEvidence(evidence({ conversationId: 'conv_b', updates: [{ name: '傅里叶变换', performance: 'partial' }] }))

    const inA = await store.listByConversation('conv_a')
    const inB = await store.listByConversation('conv_b')
    expect(inA.map((c) => c.name)).toContain('傅里叶变换')
    expect(inB.map((c) => c.name)).toContain('傅里叶变换')

    const state = (await store.load())[0]
    expect(state.evidenceConversationId).toBe('conv_b')
    expect(state.evidenceConversationIds).toEqual(['conv_a', 'conv_b'])
  })

  it('并发 applyEvidence 不丢更新（写队列串行化）', async () => {
    const calls = Array.from({ length: 10 }, (_, i) =>
      store.applyEvidence(
        evidence({
          conversationId: 'conv_a',
          messageIds: [`m${i}`],
          updates: [{ name: '卷积', performance: 'correct' }]
        })
      )
    )
    await Promise.all(calls)

    const all = await store.load()
    expect(all).toHaveLength(1)
    // Every one of the 10 increments must have landed.
    expect(all[0].attemptCount).toBe(10)
    expect(all[0].correctCount).toBe(10)
    expect(all[0].evidenceMessageIds).toHaveLength(10)
  })

  it('并发写后文件仍是合法 JSON（原子写无残留）', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        store.applyEvidence(evidence({ messageIds: [`x${i}`], updates: [{ name: `概念${i}`, performance: 'unclear' }] }))
      )
    )
    const all = await store.load()
    expect(all).toHaveLength(5)
  })

  it('持久化：重新实例化后数据仍在', async () => {
    await store.applyEvidence(evidence({ updates: [{ name: '导数', performance: 'correct' }] }))
    const reloaded = new ConceptStore(dataRoot)
    const all = await reloaded.load()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('导数')
  })

  it('从缺少 evidenceConversationIds 的旧数据继续累积证据会话', async () => {
    await store.applyEvidence(
      evidence({ conversationId: 'conv_a', updates: [{ name: '导数', performance: 'correct' }] })
    )
    const path = join(dataRoot, 'concepts.json')
    const states = JSON.parse(await readFile(path, 'utf-8')) as Array<Record<string, unknown>>
    delete states[0].evidenceConversationIds
    await writeFile(path, JSON.stringify(states, null, 2), 'utf-8')

    await store.applyEvidence(
      evidence({
        conversationId: 'conv_b',
        messageIds: ['m9'],
        updates: [{ name: '导数', performance: 'correct' }]
      })
    )

    const merged = (await store.load())[0]
    expect(merged.evidenceConversationIds).toEqual(['conv_a', 'conv_b'])
    expect(merged.evidenceMessageIds).toContain('m9')
  })
})

describe('parseUpdates', () => {
  it('解析标准 JSON 数组', () => {
    const out = parseUpdates('[{"name":"复数","performance":"partial","misconception":"虚部理解模糊"}]')
    expect(out).toEqual([{ name: '复数', performance: 'partial', misconception: '虚部理解模糊' }])
  })

  it('从带前后文字的输出中提取 JSON 片段', () => {
    const out = parseUpdates('好的，分析如下：\n[{"name":"傅里叶","performance":"correct"}]\n以上。')
    expect(out).toEqual([{ name: '傅里叶', performance: 'correct' }])
  })

  it('过滤非法项', () => {
    const out = parseUpdates('[{"name":"A","performance":"correct"},{"name":"","performance":"correct"},{"name":"B","performance":"bad"}]')
    expect(out).toEqual([{ name: 'A', performance: 'correct' }])
  })

  it('无法解析时返回 null', () => {
    expect(parseUpdates('不是 JSON')).toBeNull()
  })
})
