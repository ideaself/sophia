// @vitest-environment jsdom
/**
 * WebDavSyncView — configuration, connection test, push/pull planning +
 * confirmations, remote trash and progress reporting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { WebDavSyncView } from '../../../src/renderer/src/components/WebDavSyncView'
import { useTextbookStore } from '../../../src/renderer/src/stores/useTextbookStore'
import { useConversationStore } from '../../../src/renderer/src/stores/useConversationStore'

const sync = {
  hasWebdavPassword: vi.fn(async () => false),
  setWebdavPassword: vi.fn(async () => {}),
  test: vi.fn(),
  planPush: vi.fn(),
  push: vi.fn(),
  planPull: vi.fn(),
  pull: vi.fn(),
  listTrash: vi.fn(),
  emptyTrash: vi.fn(),
  onProgress: vi.fn(
    (_cb: (p: { current: number; total: number; file: string }) => void) => () => {}
  )
}
const confirmDialog = vi.fn(async (_options: { message: string; confirmLabel?: string }) => true)

let progressCb: ((p: { current: number; total: number; file: string }) => void) | null = null

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(sync)) fn.mockClear()
  confirmDialog.mockReset().mockResolvedValue(true)
  progressCb = null
  sync.onProgress.mockImplementation((cb) => {
    progressCb = cb
    return () => {
      progressCb = null
    }
  })

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { sync, dialog: { confirm: confirmDialog } }
  })

  useTextbookStore.setState({ fetch: vi.fn(async () => {}) })
  useConversationStore.setState({ fetchActive: vi.fn(async () => {}) })
})

afterEach(cleanup)

function setupMocks(overrides: Partial<Record<keyof typeof sync, unknown>> = {}): void {
  sync.test.mockResolvedValue({ success: true, message: 'Connected' })
  sync.planPush.mockResolvedValue({ deleteCount: 0, deleteSample: [] })
  sync.push.mockResolvedValue({
    success: true,
    transferred: 3,
    skipped: 1,
    trashed: 0,
    deleted: 0,
    errors: [],
    timestamp: '2026-09-16T10:00:00.000Z'
  })
  sync.planPull.mockResolvedValue({ deleteCount: 0, deleteSample: [] })
  sync.pull.mockResolvedValue({
    success: true,
    transferred: 2,
    skipped: 0,
    deleted: 0,
    conflicts: 0,
    errors: [],
    timestamp: '2026-09-16T11:00:00.000Z'
  })
  sync.listTrash.mockResolvedValue({ batches: [], fileCount: 0, totalSize: 0 })
  sync.emptyTrash.mockResolvedValue({ deletedBatches: 2 })
  Object.assign(sync, overrides)
}

function fillUrl(url = 'https://dav.example/dav'): HTMLInputElement {
  const input = screen.getByPlaceholderText('https://dav.example.com') as HTMLInputElement
  fireEvent.change(input, { target: { value: url } })
  return input
}

describe('WebDavSyncView — configuration', () => {
  it('starts with disabled actions and the empty-trash hint', () => {
    setupMocks()
    render(<WebDavSyncView />)

    expect((screen.getByText('Test Connection') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Push (Upload)') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/推送时被移除的远端文件/)).toBeTruthy()
    expect(sync.onProgress).toHaveBeenCalled()
  })

  it('saves the URL/username and stores a new password on test', async () => {
    setupMocks()
    render(<WebDavSyncView />)

    fillUrl()
    const usernameInput = screen.getAllByRole('textbox')[1]
    fireEvent.change(usernameInput, { target: { value: 'alice' } })
    fireEvent.change(screen.getByPlaceholderText('Not set'), { target: { value: 'pw' } })

    fireEvent.click(screen.getByText('Test Connection'))

    await waitFor(() => expect(sync.test).toHaveBeenCalledTimes(1))
    expect(sync.test).toHaveBeenCalledWith({ url: 'https://dav.example/dav', username: 'alice' })
    expect(sync.setWebdavPassword).toHaveBeenCalledWith('pw')
    expect(localStorage.getItem('webdav-url')).toBe('https://dav.example/dav')
    await waitFor(() => expect(screen.getByText('OK: Connected')).toBeTruthy())
  })

  it('reports connection failures and thrown errors', async () => {
    setupMocks({ test: vi.fn(async () => ({ success: false, message: '401 Unauthorized' })) })
    render(<WebDavSyncView />)
    fillUrl()
    fireEvent.click(screen.getByText('Test Connection'))
    await screen.findByText('Error: 401 Unauthorized')

    sync.test.mockRejectedValueOnce(new Error('network down'))
    fireEvent.click(screen.getByText('Test Connection'))
    await screen.findByText('Error: network down')
  })
})

describe('WebDavSyncView — push', () => {
  it('pushes and records the timestamp', async () => {
    setupMocks()
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('Push (Upload)'))

    await screen.findByText('OK: Pushed 3, skipped 1, trashed 0, deleted 0')
    expect(localStorage.getItem('webdav-last-push')).toBe('2026-09-16T10:00:00.000Z')
    expect(confirmDialog).not.toHaveBeenCalled()
  })

  it('asks before deleting remote files and aborts when declined', async () => {
    setupMocks({
      planPush: vi.fn(async () => ({ deleteCount: 2, deleteSample: ['a.md', 'b.md'] }))
    })
    confirmDialog.mockResolvedValue(false)
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('Push (Upload)'))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1))
    expect(confirmDialog.mock.calls[0][0].message).toContain('REMOVE 2 remote file(s)')
    expect(sync.push).not.toHaveBeenCalled()
  })

  it('surfaces push failures and planning errors', async () => {
    setupMocks({
      push: vi.fn(async () => ({
        success: false,
        transferred: 1,
        skipped: 0,
        trashed: 0,
        deleted: 0,
        errors: ['write denied']
      }))
    })
    render(<WebDavSyncView />)
    fillUrl()
    fireEvent.click(screen.getByText('Push (Upload)'))
    await screen.findByText(/1 errors: write denied/)

    sync.planPush.mockRejectedValueOnce(new Error('plan blew up'))
    fireEvent.click(screen.getByText('Push (Upload)'))
    await screen.findByText('Error: plan blew up')
    expect(sync.push).toHaveBeenCalledTimes(1)
  })

  it('shows the progress bar from sync events while pushing', async () => {
    let resolvePush: (v: unknown) => void = () => {}
    setupMocks({
      push: vi.fn(
        () =>
          new Promise((resolve) => {
            resolvePush = resolve
          })
      )
    })
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('Push (Upload)'))
    await screen.findByText('Pushing...')

    progressCb?.({ current: 2, total: 4, file: 'data.json' })
    await screen.findByText('2/4 — data.json')

    resolvePush({
      success: true,
      transferred: 4,
      skipped: 0,
      trashed: 0,
      deleted: 0,
      errors: [],
      timestamp: '2026-09-16T12:00:00.000Z'
    })
    await screen.findByText('OK: Pushed 4, skipped 0, trashed 0, deleted 0')
  })
})

describe('WebDavSyncView — pull', () => {
  it('warns when local data changed since the last push', async () => {
    localStorage.setItem('webdav-last-push', '2026-09-16T08:00:00.000Z')
    setupMocks()
    confirmDialog.mockResolvedValue(false)
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('Pull (Download)'))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1))
    expect(confirmDialog.mock.calls[0][0].message).toContain('Local data may have been modified')
    expect(sync.pull).not.toHaveBeenCalled()
  })

  it('pulls with conflict reporting and refreshes the stores', async () => {
    setupMocks({
      pull: vi.fn(async () => ({
        success: true,
        transferred: 5,
        skipped: 1,
        deleted: 2,
        conflicts: 3,
        errors: [],
        timestamp: '2026-09-16T13:00:00.000Z'
      }))
    })
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('Pull (Download)'))

    await screen.findByText('OK: Pulled 5, skipped 1, deleted 2, conflicts preserved 3')
    expect(localStorage.getItem('webdav-last-pull')).toBe('2026-09-16T13:00:00.000Z')
    expect(useTextbookStore.getState().fetch).toHaveBeenCalled()
    expect(useConversationStore.getState().fetchActive).toHaveBeenCalled()
  })

  it('asks before deleting local files and reports pull errors', async () => {
    setupMocks({
      planPull: vi.fn(async () => ({ deleteCount: 1, deleteSample: ['x.json'] })),
      pull: vi.fn(async () => ({
        success: false,
        transferred: 0,
        skipped: 0,
        deleted: 0,
        conflicts: 0,
        errors: ['conflict']
      }))
    })
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('Pull (Download)'))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1))
    expect(confirmDialog.mock.calls[0][0].message).toContain('DELETE 1 local file(s)')
    await screen.findByText(/1 errors: conflict/)
  })
})

describe('WebDavSyncView — remote trash', () => {
  it('lists trash batches and empties them after confirmation', async () => {
    setupMocks({
      listTrash: vi.fn(async () => ({
        fileCount: 3,
        totalSize: 2 * 1048576,
        batches: [{ name: '2026-09-16T08-00-00', fileCount: 3, totalSize: 2 * 1048576 }]
      }))
    })
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('刷新'))

    await screen.findByText(/共 3 个文件（2.0 MB），1 批/)
    expect(screen.getByText(/3 个 · 2.0 MB/)).toBeTruthy()

    fireEvent.click(screen.getByText('清空回收站'))
    await screen.findByText('OK: 已清空远端回收站（2 批）')
    expect(sync.emptyTrash).toHaveBeenCalledWith({ url: 'https://dav.example/dav', username: '' })
  })

  it('shows an empty trash and tolerates listing errors', async () => {
    setupMocks()
    render(<WebDavSyncView />)
    fillUrl()
    fireEvent.click(screen.getByText('刷新'))
    await screen.findByText('回收站为空。')
    expect(screen.queryByText('清空回收站')).toBeNull()

    sync.listTrash.mockRejectedValueOnce(new Error('dav down'))
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => expect(sync.listTrash).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/推送时被移除的远端文件/)).toBeTruthy()
  })
})

describe('WebDavSyncView — remaining error branches', () => {
  it('does not fetch the trash without a server URL', async () => {
    setupMocks()
    render(<WebDavSyncView />)
    await screen.findByText('WebDAV Sync')

    // No URL configured → the trash lookup is skipped entirely.
    expect(sync.listTrash).not.toHaveBeenCalled()
  })

  it('reports a thrown push failure', async () => {
    setupMocks({ push: vi.fn(async () => { throw new Error('disk full') }) })
    render(<WebDavSyncView />)
    await screen.findByText('WebDAV Sync')

    fillUrl()
    fireEvent.click(screen.getByText('Push (Upload)'))

    await waitFor(() => expect(sync.push).toHaveBeenCalled())
    expect(await screen.findByText(/disk full/)).toBeTruthy()
  })

  it('reports pull planning failures and thrown pull failures', async () => {
    setupMocks({
      planPull: vi.fn(async () => {
        throw new Error('plan exploded')
      })
    })
    render(<WebDavSyncView />)
    await screen.findByText('WebDAV Sync')

    fillUrl()
    fireEvent.click(screen.getByText('Pull (Download)'))
    expect(await screen.findByText(/plan exploded/)).toBeTruthy()

    setupMocks({
      planPull: vi.fn(async () => ({ deleteCount: 0, deleteSample: [] })),
      pull: vi.fn(async () => {
        throw new Error('pull exploded')
      })
    })
    fireEvent.click(screen.getByText('Pull (Download)'))
    expect(await screen.findByText(/pull exploded/)).toBeTruthy()
  })

  it('aborts the pull when the local-deletion warning is declined', async () => {
    setupMocks({
      planPull: vi.fn(async () => ({ deleteCount: 3, deleteSample: ['a.md', 'b.md'] }))
    })
    render(<WebDavSyncView />)
    await screen.findByText('WebDAV Sync')
    fillUrl()

    // Decline the deletion warning.
    confirmDialog.mockResolvedValue(false)
    fireEvent.click(screen.getByText('Pull (Download)'))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    expect(sync.pull).not.toHaveBeenCalled()
  })

  it('ignores emptying an empty trash and reports clear failures', async () => {
    setupMocks()
    const view = render(<WebDavSyncView />)
    await screen.findByText('WebDAV Sync')
    fillUrl()

    // Nothing to empty → the button is not even rendered.
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => expect(sync.listTrash).toHaveBeenCalled())
    expect(await screen.findByText('回收站为空。')).toBeTruthy()
    expect(screen.queryByText('清空回收站')).toBeNull()
    expect(sync.emptyTrash).not.toHaveBeenCalled()
    view.unmount()

    setupMocks({
      hasWebdavPassword: vi.fn(async () => true),
      listTrash: vi.fn(async () => ({
        batches: [{ name: 'b1', fileCount: 2, totalSize: 100 }],
        fileCount: 2,
        totalSize: 100
      })),
      emptyTrash: vi.fn(async () => {
        throw new Error('trash exploded')
      })
    })
    render(<WebDavSyncView />)
    await screen.findByText('WebDAV Sync')
    fillUrl()

    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => expect(sync.listTrash).toHaveBeenCalled())
    fireEvent.click(await screen.findByText('清空回收站'))
    await waitFor(() => expect(sync.emptyTrash).toHaveBeenCalled())
    expect(await screen.findByText(/trash exploded/)).toBeTruthy()
  })
})

describe('WebDavSyncView — uncovered result branches', () => {
  it('falls back to Unknown result and shows the testing state', async () => {
    let resolveTest!: (v: unknown) => void
    setupMocks({
      test: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveTest = resolve
          })
      )
    })
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('Test Connection'))
    await screen.findByText('Testing...')

    resolveTest({ success: true })
    await screen.findByText('OK: Unknown result')
  })

  it('reports a non-Error connection-test rejection', async () => {
    setupMocks()
    render(<WebDavSyncView />)
    fillUrl()

    sync.test.mockRejectedValueOnce('plain failure')
    fireEvent.click(screen.getByText('Test Connection'))
    await screen.findByText('Error: Failed')
  })

  it('confirms a large push deletion and continues when accepted', async () => {
    setupMocks({
      planPush: vi.fn(async () => ({
        deleteCount: 12,
        deleteSample: Array.from({ length: 12 }, (_, i) => `f${i}.md`)
      }))
    })
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('Push (Upload)'))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1))
    expect(confirmDialog.mock.calls[0][0].message).toContain('... and 2 more')
    await screen.findByText('OK: Pushed 3, skipped 1, trashed 0, deleted 0')
  })

  it('handles push results without a timestamp and non-Error failures', async () => {
    setupMocks({
      push: vi.fn(async () => ({
        success: true,
        transferred: 1,
        skipped: 0,
        trashed: 0,
        deleted: 0,
        errors: []
      }))
    })
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('Push (Upload)'))
    await screen.findByText('OK: Pushed 1, skipped 0, trashed 0, deleted 0')
    expect(screen.getByText(/Last push: never/)).toBeTruthy()

    sync.push.mockRejectedValueOnce('plain push failure')
    fireEvent.click(screen.getByText('Push (Upload)'))
    await screen.findByText('Error: Push failed')

    sync.planPush.mockRejectedValueOnce('plain planning failure')
    fireEvent.click(screen.getByText('Push (Upload)'))
    await screen.findByText('Error: Push planning failed')
  })

  it('warns with <1h for a fresh last push and pulls when confirmed', async () => {
    localStorage.setItem('webdav-last-push', new Date().toISOString())
    setupMocks()
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('Pull (Download)'))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1))
    expect(confirmDialog.mock.calls[0][0].message).toContain('<1h')
    await screen.findByText('OK: Pulled 2, skipped 0, deleted 0')
    expect(localStorage.getItem('webdav-last-pull')).toBe('2026-09-16T11:00:00.000Z')
  })

  it('shows the pulling state while the download is pending', async () => {
    let resolvePull!: (v: unknown) => void
    setupMocks({
      pull: vi.fn(
        () =>
          new Promise((resolve) => {
            resolvePull = resolve
          })
      )
    })
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('Pull (Download)'))
    await screen.findByText('Pulling...')

    resolvePull({
      success: true,
      transferred: 0,
      skipped: 0,
      deleted: 0,
      conflicts: 0,
      errors: [],
      timestamp: '2026-09-16T14:00:00.000Z'
    })
    await screen.findByText('OK: Pulled 0, skipped 0, deleted 0')
  })

  it('handles a large pull deletion and non-Error failures', async () => {
    setupMocks({
      planPull: vi.fn(async () => ({
        deleteCount: 11,
        deleteSample: Array.from({ length: 11 }, (_, i) => `g${i}.json`)
      }))
    })
    render(<WebDavSyncView />)
    fillUrl()

    fireEvent.click(screen.getByText('Pull (Download)'))
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1))
    expect(confirmDialog.mock.calls[0][0].message).toContain('... and 1 more')
    await screen.findByText('OK: Pulled 2, skipped 0, deleted 0')

    sync.planPull.mockRejectedValueOnce('plain pull planning failure')
    fireEvent.click(screen.getByText('Pull (Download)'))
    await screen.findByText('Error: Pull planning failed')

    sync.pull.mockRejectedValueOnce('plain pull failure')
    fireEvent.click(screen.getByText('Pull (Download)'))
    await screen.findByText('Error: Pull failed')
  })

  it('shows the emptying state and non-Error clear failures', async () => {
    setupMocks({
      listTrash: vi.fn(async () => ({
        batches: [{ name: 'b1', fileCount: 2, totalSize: 100 }],
        fileCount: 2,
        totalSize: 100
      }))
    })
    let rejectEmpty!: (e: unknown) => void
    sync.emptyTrash.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectEmpty = reject
        })
    )
    render(<WebDavSyncView />)
    await screen.findByText('WebDAV Sync')
    fillUrl()

    fireEvent.click(screen.getByText('刷新'))
    fireEvent.click(await screen.findByText('清空回收站'))
    await screen.findByText('清空中...')

    rejectEmpty('plain trash failure')
    await screen.findByText('Error: 清空失败')
  })
})

describe('WebDavSyncView — trash guards', () => {
  it('skips the trash fetch without a URL', async () => {
    setupMocks()
    render(<WebDavSyncView />)
    await screen.findByText('WebDAV Sync')

    // No URL yet → refresh is a no-op.
    fireEvent.click(screen.getByText('刷新'))
    expect(sync.listTrash).not.toHaveBeenCalled()
  })

  it('keeps the trash when the clear confirmation is declined', async () => {
    setupMocks({
      hasWebdavPassword: vi.fn(async () => true),
      listTrash: vi.fn(async () => ({
        batches: [{ name: 'b1', fileCount: 2, totalSize: 100 }],
        fileCount: 2,
        totalSize: 100
      }))
    })
    render(<WebDavSyncView />)
    await screen.findByText('WebDAV Sync')
    fillUrl()
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => expect(sync.listTrash).toHaveBeenCalled())

    confirmDialog.mockResolvedValue(false)
    fireEvent.click(await screen.findByText('清空回收站'))
    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    expect(sync.emptyTrash).not.toHaveBeenCalled()
  })
})
