import { useEffect, useState } from 'react'

/** Shared TTL so remounting the classroom does not re-scan every message. */
const CACHE_TTL_MS = 60_000

let cache: { value: number; at: number } | null = null
let inflight: Promise<number> | null = null

function loadTodayStudyMinutes(): Promise<number> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return Promise.resolve(cache.value)
  }
  if (!inflight) {
    inflight = window.sophia.data
      .todayStudyMinutes()
      .then((value) => {
        cache = { value, at: Date.now() }
        return value
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/**
 * 今日已学习时长（分钟），供顶栏「每日目标」进度环使用。
 *
 * 聚合在主进程完成（避免把全部消息经 IPC 搬到渲染层），配合 60 秒
 * TTL 缓存 + 单飞请求 + 聚焦防抖：切换到课堂视图、窗口反复聚焦都不会
 * 触发全量扫描。
 */
export function useTodayStudyMinutes(): number {
  const [minutes, setMinutes] = useState(cache?.value ?? 0)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const value = await loadTodayStudyMinutes()
        if (!cancelled) setMinutes(value)
      } catch {
        // 保留上次值
      }
    }
    void load()

    let focusTimer: ReturnType<typeof setTimeout> | null = null
    const onFocus = (): void => {
      if (focusTimer) clearTimeout(focusTimer)
      focusTimer = setTimeout(() => {
        focusTimer = null
        void load()
      }, 800)
    }
    window.addEventListener('focus', onFocus)
    const timer = setInterval(() => {
      void load()
    }, 5 * 60_000)

    return () => {
      cancelled = true
      if (focusTimer) clearTimeout(focusTimer)
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
    }
  }, [])

  return minutes
}
