/**
 * Frame coalescer — merge bursts of notifications into one flush per frame.
 *
 * Framework-free so it is testable from the node-side test project and
 * usable from any renderer hook.
 */

export interface FrameCoalescer {
  /** Request a flush; repeated calls within one frame collapse into one. */
  schedule(): void
  /** Cancel a pending flush; later schedule() calls are ignored. */
  dispose(): void
}

/**
 * A fast stream can emit hundreds of tokens between two paints; re-rendering
 * on every token burns CPU for frames nobody sees. Falls back to a ~16ms
 * timer when requestAnimationFrame is unavailable (tests / hidden windows).
 */
export function createFrameCoalescer(flush: () => void): FrameCoalescer {
  const hasRaf = typeof requestAnimationFrame === 'function'
  const requestFrame = (cb: () => void): number =>
    hasRaf ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number)
  const cancelFrame = (id: number): void => {
    if (hasRaf) cancelAnimationFrame(id)
    else clearTimeout(id)
  }

  let frameId: number | null = null
  let disposed = false

  return {
    schedule() {
      if (disposed || frameId !== null) return
      frameId = requestFrame(() => {
        frameId = null
        if (!disposed) flush()
      })
    },
    dispose() {
      disposed = true
      if (frameId !== null) {
        cancelFrame(frameId)
        frameId = null
      }
    }
  }
}
