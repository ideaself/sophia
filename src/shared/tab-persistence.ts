/**
 * Persistence for the classroom tab strip (localStorage).
 *
 * Only durable state is stored: title, conversationId, and the unsent
 * input draft. Messages always reload from the conversation store, and
 * transient state (streaming, retry, end result) is intentionally dropped.
 */

export interface PersistedTab {
  title: string
  conversationId: string | null
  input: string
}

export interface PersistedTabsState {
  tabs: PersistedTab[]
  activeIdx: number
}

/** Minimal Storage shape so tests can inject a fake. */
export interface TabsStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export const CLASSROOM_TABS_KEY = 'classroom-tabs-v1'

/**
 * Build the persistable snapshot: tabs with no conversation and no draft
 * carry nothing worth restoring, so they are dropped and activeIdx is
 * remapped to the nearest kept tab at-or-before the original index.
 */
export function serializeTabs(
  tabs: Array<{ title: string; conversationId: string | null; input: string }>,
  activeIdx: number
): PersistedTabsState {
  const kept: Array<{ tab: PersistedTab; origIdx: number }> = []
  tabs.forEach((t, i) => {
    if (t.conversationId || t.input.trim().length > 0) {
      kept.push({
        tab: { title: t.title, conversationId: t.conversationId, input: t.input },
        origIdx: i
      })
    }
  })
  let newActive = 0
  for (let i = 0; i < kept.length; i++) {
    if (kept[i].origIdx <= activeIdx) newActive = i
  }
  return {
    tabs: kept.map((k) => k.tab),
    activeIdx: kept.length > 0 ? Math.min(newActive, kept.length - 1) : 0
  }
}

/** Parse a stored snapshot; returns null on any malformed input. */
export function parsePersistedTabs(raw: string | null): PersistedTabsState | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<PersistedTabsState> | null
    if (!data || !Array.isArray(data.tabs) || data.tabs.length === 0) return null
    const tabs: PersistedTab[] = []
    for (const t of data.tabs) {
      if (!t || typeof t !== 'object') continue
      const tab = t as Partial<PersistedTab>
      tabs.push({
        title: typeof tab.title === 'string' ? tab.title : '新对话',
        conversationId: typeof tab.conversationId === 'string' ? tab.conversationId : null,
        input: typeof tab.input === 'string' ? tab.input : ''
      })
    }
    if (tabs.length === 0) return null
    const activeIdx = Math.min(Math.max(0, data.activeIdx ?? 0), tabs.length - 1)
    return { tabs, activeIdx }
  } catch {
    return null
  }
}

export function loadTabs(storage: TabsStorage, key: string = CLASSROOM_TABS_KEY): PersistedTabsState | null {
  return parsePersistedTabs(storage.getItem(key))
}

export function saveTabs(
  storage: TabsStorage,
  state: PersistedTabsState,
  key: string = CLASSROOM_TABS_KEY
): void {
  try {
    storage.setItem(key, JSON.stringify(state))
  } catch {
    // Quota exceeded or storage unavailable — persistence is best-effort.
  }
}
