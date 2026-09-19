import { useCallback, useEffect, useState } from 'react'

/**
 * 到期概念数（导航徽标 / 每日提醒）。
 *
 * 统计在主进程完成（单次 IPC 返回一个数字）；hook 只在挂载、窗口聚焦
 * （防抖 800ms）与每分钟刷新，窗口隐藏时跳过。
 */
export function useDueConceptCount(): number {
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    // No point scanning while the window is in the background.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    try {
      const { due } = await window.sophia.data.dueConceptCount()
      setCount(due)
    } catch {
      // keep the previous value on failure
    }
  }, [])

  useEffect(() => {
    void refresh()

    let focusTimer: ReturnType<typeof setTimeout> | null = null
    const onFocus = (): void => {
      if (focusTimer) clearTimeout(focusTimer)
      focusTimer = setTimeout(() => {
        focusTimer = null
        void refresh()
      }, 800)
    }

    window.addEventListener('focus', onFocus)
    const timer = setInterval(() => {
      void refresh()
    }, 60_000)
    return () => {
      if (focusTimer) clearTimeout(focusTimer)
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
    }
  }, [refresh])

  return count
}
