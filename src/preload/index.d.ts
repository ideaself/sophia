import type { SophiaAPI, StreamErrorData, StreamUsageData } from './index'

declare global {
  interface Window {
    sophia: SophiaAPI
  }
}

export type { StreamErrorData, StreamUsageData }
