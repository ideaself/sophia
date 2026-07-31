declare module 'unzipper' {
  import type { Writable } from 'node:stream'
  export class Extract extends Writable {
    constructor(options: { path: string })
  }
}
