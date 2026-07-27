import { readFile } from 'node:fs/promises'

if (typeof globalThis.DOMMatrix === 'undefined') {
  ;(globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1
    b = 0
    c = 0
    d = 1
    e = 0
    f = 0
    constructor(init?: any) {
      if (Array.isArray(init) && init.length === 6) {
        this.a = init[0]
        this.b = init[1]
        this.c = init[2]
        this.d = init[3]
        this.e = init[4]
        this.f = init[5]
      }
    }
    translateSelf(tx: number, ty = 0) {
      this.e = this.a * tx + this.c * ty + this.e
      this.f = this.b * tx + this.d * ty + this.f
      return this
    }
    scaleSelf(sx: number, sy = sx) {
      this.a *= sx
      this.b *= sx
      this.c *= sy
      this.d *= sy
      return this
    }
    multiplySelf() {
      return this
    }
    inverse() {
      return new DOMMatrix()
    }
    toString() {
      return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`
    }
  }
}

if (typeof globalThis.Path2D === 'undefined') {
  ;(globalThis as any).Path2D = class Path2D {
    constructor() {}
    addPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    quadraticCurveTo() {}
    bezierCurveTo() {}
    rect() {}
    arc() {}
    arcTo() {}
    ellipse() {}
  }
}

if (typeof globalThis.ImageData === 'undefined') {
  ;(globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray
    width: number
    height: number
    constructor(dataOrWidth: any, heightOrData?: any, height?: any) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth
        this.height = heightOrData ?? height ?? 0
        this.data = new Uint8ClampedArray(this.width * this.height * 4)
      } else {
        this.data = new Uint8ClampedArray(dataOrWidth)
        this.width = heightOrData ?? 0
        this.height = height ?? 0
      }
    }
  }
}

let cachedUnpdf: typeof import('unpdf') | null = null

async function loadUnpdf() {
  if (!cachedUnpdf) {
    cachedUnpdf = await import('unpdf')
  }
  return cachedUnpdf
}

export interface ParseResult {
  content: string
  totalPages: number
}

export async function extractPdfText(filePath: string): Promise<ParseResult> {
  const { getDocumentProxy, extractText } = await loadUnpdf()

  const buffer = await readFile(filePath)
  const data = new Uint8Array(buffer)

  const pdf = await getDocumentProxy(data)
  const result = await extractText(pdf, { mergePages: true })

  return {
    content: result.text,
    totalPages: result.totalPages
  }
}