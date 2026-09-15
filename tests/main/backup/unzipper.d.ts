declare module 'unzipper' {
  import type { Writable, Readable } from 'node:stream'

  export class Extract extends Writable {
    constructor(options: { path: string })
  }

  export interface Entry {
    path: string
    type: 'File' | 'Directory'
    uncompressedSize: number
    stream(): Readable
  }

  export interface Directory {
    files: Entry[]
  }

  export const Open: {
    file(path: string): Promise<Directory>
  }

  export const Parse: {
    file(path: string): Promise<Directory>
  }
}
