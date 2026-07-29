import { describe, it, expect } from 'vitest'
import {
  serializeTabs,
  parsePersistedTabs,
  loadTabs,
  saveTabs,
  type TabsStorage
} from '../../src/shared/tab-persistence'

function fakeStorage(): TabsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) }
  }
}

describe('serializeTabs', () => {
  it('drops tabs with no conversation and no draft', () => {
    const state = serializeTabs([
      { title: '空标签', conversationId: null, input: '' },
      { title: '课程A', conversationId: 'conv-1', input: '' },
      { title: '草稿标签', conversationId: null, input: ' 还没发出去 ' }
    ], 0)
    expect(state.tabs).toHaveLength(2)
    expect(state.tabs[0].conversationId).toBe('conv-1')
    expect(state.tabs[1].input).toBe(' 还没发出去 ')
  })

  it('remaps activeIdx to the nearest kept tab at-or-before the original index', () => {
    const state = serializeTabs([
      { title: 'A', conversationId: 'c1', input: '' },
      { title: '空', conversationId: null, input: '' },
      { title: 'B', conversationId: 'c2', input: '' }
    ], 2)
    expect(state.activeIdx).toBe(1) // tab B is now at index 1
  })

  it('keeps activeIdx on a kept tab when the original active tab was dropped', () => {
    const state = serializeTabs([
      { title: 'A', conversationId: 'c1', input: '' },
      { title: '空', conversationId: null, input: '   ' }
    ], 1)
    expect(state.tabs).toHaveLength(1)
    expect(state.activeIdx).toBe(0)
  })

  it('returns an empty tab list when nothing is worth persisting', () => {
    const state = serializeTabs([{ title: '空', conversationId: null, input: '' }], 0)
    expect(state.tabs).toHaveLength(0)
    expect(state.activeIdx).toBe(0)
  })
})

describe('parsePersistedTabs', () => {
  it('returns null for null/empty input', () => {
    expect(parsePersistedTabs(null)).toBeNull()
    expect(parsePersistedTabs('')).toBeNull()
  })

  it('returns null for malformed JSON or wrong shapes', () => {
    expect(parsePersistedTabs('not json')).toBeNull()
    expect(parsePersistedTabs('{"tabs": "nope"}')).toBeNull()
    expect(parsePersistedTabs('{"tabs": []}')).toBeNull()
  })

  it('normalizes missing fields and clamps activeIdx', () => {
    const state = parsePersistedTabs(JSON.stringify({
      tabs: [{ conversationId: 'c1' }, { title: 'B', conversationId: 42, input: 7 }],
      activeIdx: 99
    }))
    expect(state).not.toBeNull()
    expect(state!.tabs[0]).toEqual({ title: '新对话', conversationId: 'c1', input: '' })
    expect(state!.tabs[1]).toEqual({ title: 'B', conversationId: null, input: '' })
    expect(state!.activeIdx).toBe(1)
  })

  it('clamps negative activeIdx to 0', () => {
    const state = parsePersistedTabs(JSON.stringify({
      tabs: [{ title: 'A', conversationId: 'c1', input: '' }],
      activeIdx: -3
    }))
    expect(state!.activeIdx).toBe(0)
  })
})

describe('saveTabs / loadTabs round-trip', () => {
  it('persists and restores a snapshot', () => {
    const storage = fakeStorage()
    const snapshot = serializeTabs([
      { title: '课程A', conversationId: 'c1', input: '' },
      { title: '草稿', conversationId: null, input: 'hello' }
    ], 1)
    saveTabs(storage, snapshot)
    expect(loadTabs(storage)).toEqual(snapshot)
  })

  it('loadTabs returns null when nothing was saved', () => {
    expect(loadTabs(fakeStorage())).toBeNull()
  })

  it('saveTabs swallows storage errors', () => {
    const broken: TabsStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded') }
    }
    expect(() => saveTabs(broken, { tabs: [], activeIdx: 0 })).not.toThrow()
  })
})
