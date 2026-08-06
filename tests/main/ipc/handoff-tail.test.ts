import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ConversationStore } from '../../../src/main/storage/conversation-store'
import { ArtifactStore } from '../../../src/main/storage/artifact-store'
import { handoffMetaPath } from '../../../src/main/storage/app-data'
import { loadHandoffTail } from '../../../src/main/ipc/chat-prompt'
import type { WorldId, ConversationId } from '../../../src/shared/types/ids'

const WORLD_ID = 'world_default' as WorldId
const COMPANION = 'comp_fourier'

let dataRoot: string
let conversationStore: ConversationStore
let artifactStore: ArtifactStore

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-handoff-'))
  conversationStore = new ConversationStore(dataRoot)
  artifactStore = new ArtifactStore(dataRoot)
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

/** 造一节已下课的课（可选教材），并为其写入 handoff_tail 产物。 */
async function makeEndedClass(convId: string, textbookId: string | null, tail = '傅里叶光学：上次讲到菲涅耳衍射'): Promise<void> {
  const conv = await conversationStore.create({
    worldId: WORLD_ID,
    companionId: COMPANION,
    textbookId,
    title: 'test'
  })
  await conversationStore.addMessage(conv.id, WORLD_ID, 'user', '上课')
  await conversationStore.addMessage(conv.id, WORLD_ID, 'assistant', '好的')
  await conversationStore.endConversation(conv.id, WORLD_ID)
  await artifactStore.create(conv.id as ConversationId, WORLD_ID, 'handoff_tail', tail)
  void convId
}

async function writeMeta(prevConvId: string, textbookId: string | null): Promise<void> {
  const filePath = handoffMetaPath(dataRoot, WORLD_ID)
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, JSON.stringify({
    [COMPANION]: {
      savedAt: new Date().toISOString(),
      prevConvId,
      companionName: '傅里叶老师',
      companionSlot: null,
      endingPage: null,
      textbookId
    }
  }))
}

describe('loadHandoffTail — 接力尾巴按教材隔离', () => {
  it('同教材的上一课：继承接力尾巴', async () => {
    const conv = await conversationStore.create({
      worldId: WORLD_ID, companionId: COMPANION, textbookId: 'tb_fourier', title: 't'
    })
    await conversationStore.endConversation(conv.id, WORLD_ID)
    await artifactStore.create(conv.id as ConversationId, WORLD_ID, 'handoff_tail', '傅里叶光学：上次讲到菲涅耳衍射')
    await writeMeta(conv.id, 'tb_fourier')
    const res = await loadHandoffTail(dataRoot, conversationStore, artifactStore, COMPANION, WORLD_ID, 'conv_new', 'tb_fourier')
    expect(res.tail).toBe('傅里叶光学：上次讲到菲涅耳衍射')
  })

  it('换了教材：绝不继承旧教材的接力尾巴（bug 复现场景）', async () => {
    const conv = await conversationStore.create({
      worldId: WORLD_ID, companionId: COMPANION, textbookId: 'tb_fourier', title: 't'
    })
    await conversationStore.endConversation(conv.id, WORLD_ID)
    await artifactStore.create(conv.id as ConversationId, WORLD_ID, 'handoff_tail', '傅里叶光学：上次讲到菲涅耳衍射')
    await writeMeta(conv.id, 'tb_fourier')
    const res = await loadHandoffTail(dataRoot, conversationStore, artifactStore, COMPANION, WORLD_ID, 'conv_calculus', 'tb_calculus')
    expect(res.tail).toBeUndefined()
  })

  it('无教材课堂只继承无教材的上一课', async () => {
    const conv = await conversationStore.create({
      worldId: WORLD_ID, companionId: COMPANION, textbookId: 'tb_fourier', title: 't'
    })
    await conversationStore.endConversation(conv.id, WORLD_ID)
    await artifactStore.create(conv.id as ConversationId, WORLD_ID, 'handoff_tail', '傅里叶光学：上次讲到菲涅耳衍射')
    await writeMeta(conv.id, 'tb_fourier')
    const res = await loadHandoffTail(dataRoot, conversationStore, artifactStore, COMPANION, WORLD_ID, 'conv_free', null)
    expect(res.tail).toBeUndefined()
  })

  it('legacy 回退（无 meta 文件）：按教材过滤已下课课堂', async () => {
    await makeEndedClass('conv_fourier_ended', 'tb_fourier')
    await makeEndedClass('conv_calculus_ended', 'tb_calculus', '微积分：上次讲到导数定义')

    // 新开微积分课 → 只能拿到微积分那一课的尾巴
    const calculus = await loadHandoffTail(dataRoot, conversationStore, artifactStore, COMPANION, WORLD_ID, 'conv_calculus_new', 'tb_calculus')
    expect(calculus.tail).toBe('微积分：上次讲到导数定义')

    // 新开傅里叶课 → 拿到傅里叶的尾巴
    const fourier = await loadHandoffTail(dataRoot, conversationStore, artifactStore, COMPANION, WORLD_ID, 'conv_fourier_new', 'tb_fourier')
    expect(fourier.tail).toBe('傅里叶光学：上次讲到菲涅耳衍射')
  })

  it('当前课堂自身不参与接力（excludeConversationId）', async () => {
    await writeMeta('conv_self', 'tb_fourier')
    const res = await loadHandoffTail(dataRoot, conversationStore, artifactStore, COMPANION, WORLD_ID, 'conv_self', 'tb_fourier')
    expect(res.tail).toBeUndefined()
  })
})
