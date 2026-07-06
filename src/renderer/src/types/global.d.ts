export {}

declare global {
  interface SophiaAPI {
    getVersion: () => Promise<string>
    getPlatform: () => Promise<string>
  }

  interface Window {
    sophia: SophiaAPI
  }
}
