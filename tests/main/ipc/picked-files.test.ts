import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { PickedFileRegistry } from '../../../src/main/ipc/picked-files'

describe('PickedFileRegistry', () => {
  it('rejects paths that were never picked through the dialog', () => {
    const registry = new PickedFileRegistry()
    expect(registry.has(join(tmpdir(), 'never-picked.pdf'))).toBe(false)
  })

  it('accepts a path after it was registered', () => {
    const registry = new PickedFileRegistry()
    const picked = join(tmpdir(), 'textbook.pdf')
    registry.add(picked)
    expect(registry.has(picked)).toBe(true)
  })

  it('matches paths regardless of absolute/relative spelling', () => {
    const registry = new PickedFileRegistry()
    const absolute = join(tmpdir(), 'picked-book.epub')
    registry.add(absolute)
    // Same file spelled with a redundant segment must still match
    expect(registry.has(join(tmpdir(), 'sub', '..', 'picked-book.epub'))).toBe(true)
  })

  it('does not accept a different file in the same directory', () => {
    const registry = new PickedFileRegistry()
    registry.add(join(tmpdir(), 'picked.pdf'))
    expect(registry.has(join(tmpdir(), 'other.pdf'))).toBe(false)
  })
})
