import { describe, it, expect } from 'vitest'
import { migrateLegacySettings } from '../../src/shared/settings-migrate'

interface FakeStorage {
  length: number
  key: (i: number) => string | null
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
}

function makeStorage(initial: Record<string, string>): FakeStorage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    key: (i) => Array.from(data.keys())[i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) }
  }
}

describe('migrateLegacySettings — localStorage 键品牌迁移', () => {
  it('把旧键复制到新键', () => {
    const s = makeStorage({
      'sophia.dailyGoal': '45',
      'sophia.dictEnabled': '1'
    })
    migrateLegacySettings(s)
    expect(s.getItem('sophia.dailyGoal')).toBe('45')
    expect(s.getItem('sophia.dictEnabled')).toBe('1')
    expect(s.getItem('sophia.dailyGoal')).toBe('45') // 旧键保留，兼容回滚
  })

  it('特殊键 sophia-theme → sophia-theme', () => {
    const s = makeStorage({ 'sophia-theme': 'emerald' })
    migrateLegacySettings(s)
    expect(s.getItem('sophia-theme')).toBe('emerald')
  })

  it('新键已存在时不覆盖', () => {
    const s = makeStorage({
      'sophia.dailyGoal': '30',
      'sophia.dailyGoal': '60'
    })
    migrateLegacySettings(s)
    expect(s.getItem('sophia.dailyGoal')).toBe('60')
  })

  it('无旧键时不做任何事', () => {
    const s = makeStorage({ 'sophia.theme': 'dark', other: 'x' })
    migrateLegacySettings(s)
    expect(s.getItem('sophia.theme')).toBe('dark')
  })
})
