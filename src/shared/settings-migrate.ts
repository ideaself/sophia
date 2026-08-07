const LEGACY_PREFIX = 'sophia.'
const LEGACY_THEME_KEY = 'sophia-theme'

/**
 * 品牌迁移：把旧 localStorage 设置键一次性复制到新键（sophia.* →
 * sophia.*）。新键已存在时不覆盖（防止把新设置覆盖回旧值）。
 * 在 renderer 入口同步执行（任何组件读取设置之前）。
 */
export function migrateLegacySettings(
  storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'> = localStorage
): void {
  const copies: Array<[string, string]> = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key) continue
    const newKey =
      key === LEGACY_THEME_KEY
        ? 'sophia-theme'
        : key.startsWith(LEGACY_PREFIX)
          ? 'sophia.' + key.slice(LEGACY_PREFIX.length)
          : null
    if (newKey && storage.getItem(key) !== null && storage.getItem(newKey) === null) {
      copies.push([key, newKey])
    }
  }
  for (const [oldKey, newKey] of copies) {
    storage.setItem(newKey, storage.getItem(oldKey) as string)
  }
}
