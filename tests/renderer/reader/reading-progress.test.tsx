// @vitest-environment jsdom
/**
 * reading-progress — shared key naming, best-effort local storage and the
 * textbook-store sync shared by the EPUB / PDF readers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  progressStorageKey,
  readLocalProgress,
  writeLocalProgress,
  syncReadingProgress,
  loadSyncedProgress
} from '../../../src/renderer/src/reader/reading-progress'

function stubSophiaData(overrides: {
  getTextbook?: (id: string) => Promise<unknown>
  updateTextbookProgress?: (id: string, patch: unknown) => Promise<unknown>
}): { updateTextbookProgress: ReturnType<typeof vi.fn>; getTextbook: ReturnType<typeof vi.fn> } {
  const updateTextbookProgress = vi.fn(overrides.updateTextbookProgress ?? (async () => null))
  const getTextbook = vi.fn(overrides.getTextbook ?? (async () => null))
  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data: { updateTextbookProgress, getTextbook } }
  })
  return { updateTextbookProgress, getTextbook }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('progressStorageKey', () => {
  it('namespaces by reader kind and textbook id', () => {
    expect(progressStorageKey('epub', 'tb_1')).toBe('epub-progress-tb_1')
    expect(progressStorageKey('pdf', 'tb_2')).toBe('pdf-progress-tb_2')
  })
})

describe('readLocalProgress / writeLocalProgress', () => {
  it('round-trips values per kind and textbook', () => {
    writeLocalProgress('epub', 'tb_1', '{"chapterIndex":2,"fontSize":18,"scrollY":40}')
    writeLocalProgress('pdf', 'tb_1', '7')

    expect(readLocalProgress('epub', 'tb_1')).toBe('{"chapterIndex":2,"fontSize":18,"scrollY":40}')
    expect(readLocalProgress('pdf', 'tb_1')).toBe('7')
    expect(readLocalProgress('pdf', 'tb_2')).toBeNull()
  })

  it('returns null when reading throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => {},
      clear: () => {}
    } as unknown as Storage)

    expect(readLocalProgress('pdf', 'tb_1')).toBeNull()
  })

  it('swallows write failures (quota exceeded / storage disabled)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('quota') },
      clear: () => {}
    } as unknown as Storage)

    expect(() => writeLocalProgress('pdf', 'tb_1', '3')).not.toThrow()
  })
})

describe('syncReadingProgress', () => {
  it('pushes the patch to the textbook store', async () => {
    const { updateTextbookProgress } = stubSophiaData({})

    syncReadingProgress('tb_1', {
      currentPage: 3,
      totalPages: 10,
      readingPercentage: 0.3,
      lastPosition: '{"chapterIndex":2}'
    })

    await vi.waitFor(() => expect(updateTextbookProgress).toHaveBeenCalledTimes(1))
    expect(updateTextbookProgress).toHaveBeenCalledWith('tb_1', {
      currentPage: 3,
      totalPages: 10,
      readingPercentage: 0.3,
      lastPosition: '{"chapterIndex":2}'
    })
  })

  it('swallows store failures so reading is never interrupted', async () => {
    const { updateTextbookProgress } = stubSophiaData({
      updateTextbookProgress: async () => { throw new Error('offline') }
    })

    expect(() =>
      syncReadingProgress('tb_1', { currentPage: 1, totalPages: 5, readingPercentage: 0.2 })
    ).not.toThrow()
    await vi.waitFor(() => expect(updateTextbookProgress).toHaveBeenCalled())
  })
})

describe('loadSyncedProgress', () => {
  it('returns the stored progress blob', async () => {
    stubSophiaData({
      getTextbook: async () => ({
        id: 'tb_1',
        progress: { currentPage: 4, totalPages: 12, readingPercentage: 0.33, lastPosition: '{"chapterIndex":3}' }
      })
    })

    await expect(loadSyncedProgress('tb_1')).resolves.toEqual({
      currentPage: 4,
      totalPages: 12,
      readingPercentage: 0.33,
      lastPosition: '{"chapterIndex":3}'
    })
  })

  it('returns null when the textbook is gone', async () => {
    stubSophiaData({ getTextbook: async () => null })
    await expect(loadSyncedProgress('tb_1')).resolves.toBeNull()
  })

  it('returns null when the store call fails', async () => {
    stubSophiaData({
      getTextbook: async () => { throw new Error('db closed') }
    })
    await expect(loadSyncedProgress('tb_1')).resolves.toBeNull()
  })
})
