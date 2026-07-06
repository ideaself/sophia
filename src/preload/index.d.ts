import type { SophiaAPI } from './index'

declare global {
  interface Window {
    sophia: SophiaAPI
  }
}
