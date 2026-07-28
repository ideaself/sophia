# 教材原件保存与 PDF 阅读器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导入 PDF 时保存原件到数据目录、应用内独立页面阅读原件、原件随 WebDAV 二进制同步。

**Architecture:** 原件以固定文件名 `source.pdf` 存于教材目录（渲染端永不传路径）；主进程新增 `textbook:read-original` IPC 返回字节；渲染端新组件 `PdfReaderView` 用现有 `pdfjs-dist` 渲染 canvas；同步层按扩展名对 `.pdf` 走二进制通道。

**Tech Stack:** Electron 43 / electron-vite 3 / React 19 / TypeScript / vitest / pdfjs-dist 6（已在依赖中，零新依赖）

**Spec:** `docs/superpowers/specs/2026-07-28-textbook-original-reader-design.md`

## Global Constraints

- 不新增任何 npm 依赖（pdfjs-dist 已在 dependencies）
- `npm run typecheck` 必须保持 0 报错（上轮刚清零）
- 测试命令：`npx vitest run <path>`；全量：`npx vitest run`
- 每个 Task 结束按指定命令 commit
- UI 文案用中文，风格与现有界面一致（如"阅读原件"）
- EPUB 原件阅读不做（第一期仅 PDF）

---

### Task 1: schema + 路径辅助 + TextbookStore 原件支持

**Files:**
- Modify: `src/shared/schemas/textbook.ts`
- Modify: `src/main/storage/app-data.ts`
- Modify: `src/main/storage/textbook-store.ts`
- Test: `tests/main/storage/textbook-store.test.ts`（新建）

**Interfaces:**
- Produces:
  - `Textbook.originalFile: string`（schema 默认 `''`，兼容旧数据）
  - `textbookOriginalPath(dataRoot, textbookId, worldId?, profileId?): string` → `<dir>/source.pdf`
  - `CreateTextbookInput.originalSourcePath?: string`（原件在磁盘上的来源路径，store 负责复制进来）
  - `TextbookStore.readOriginal(textbookId: string, worldId: string): Promise<{ data: Buffer; fileName: string } | null>`

- [ ] **Step 1: 写失败测试**（新建 `tests/main/storage/textbook-store.test.ts`）

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { TextbookStore } from '../../../src/main/storage/textbook-store'
import type { WorldId } from '../../../src/shared/types/ids'

const WORLD_ID = 'world_default' as WorldId
const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x01, 0x02, 0x03])

let dataRoot: string
let importDir: string

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'sophia-tbstore-'))
  importDir = await mkdtemp(join(tmpdir(), 'sophia-import-'))
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
  await rm(importDir, { recursive: true, force: true })
})

async function createPdfTextbook(store: TextbookStore, withOriginal: boolean) {
  let originalSourcePath: string | undefined
  if (withOriginal) {
    originalSourcePath = join(importDir, '高等数学.pdf')
    await writeFile(originalSourcePath, PDF_BYTES)
  }
  return store.create({
    worldId: WORLD_ID,
    title: '高等数学',
    format: 'pdf',
    sourceFile: '高等数学.pdf',
    content: '# 解析文本',
    originalSourcePath
  })
}

describe('TextbookStore — original file', () => {
  it('create with originalSourcePath copies the file into the textbook dir as source.pdf', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, true)

    expect(tb.originalFile).toBe('source.pdf')

    const stored = await readFile(
      join(dataRoot, 'profiles', 'prof_default', 'worlds', WORLD_ID, 'textbooks', tb.id, 'source.pdf')
    )
    expect(stored.equals(PDF_BYTES)).toBe(true)
  })

  it('create without originalSourcePath records empty originalFile', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    expect(tb.originalFile).toBe('')
  })

  it('readOriginal returns the original bytes and display file name', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, true)

    const result = await store.readOriginal(tb.id, WORLD_ID)
    expect(result).not.toBeNull()
    expect(result!.data.equals(PDF_BYTES)).toBe(true)
    expect(result!.fileName).toBe('高等数学.pdf')
  })

  it('readOriginal returns null when the textbook has no original', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, false)
    expect(await store.readOriginal(tb.id, WORLD_ID)).toBeNull()
  })

  it('readOriginal returns null for a nonexistent textbook', async () => {
    const store = new TextbookStore(dataRoot)
    expect(await store.readOriginal('tb_nope', WORLD_ID)).toBeNull()
  })

  it('textbook.json round-trips through get() with originalFile preserved', async () => {
    const store = new TextbookStore(dataRoot)
    const tb = await createPdfTextbook(store, true)
    const loaded = await store.get(tb.id, WORLD_ID)
    expect(loaded?.originalFile).toBe('source.pdf')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/main/storage/textbook-store`
Expected: FAIL（`originalSourcePath` / `readOriginal` 不存在）

- [ ] **Step 3: schema 加字段**（`src/shared/schemas/textbook.ts`）

`Textbook` 接口在 `sourceFile: string` 后加：

```typescript
  originalFile: string
```

`TextbookSchema` 在 `sourceFile: z.string(),` 后加：

```typescript
  originalFile: z.string().default(''),
```

- [ ] **Step 4: 路径辅助**（`src/main/storage/app-data.ts`，放在 `textbookContentPath` 之后）

```typescript
export function textbookOriginalPath(
  dataRoot: string,
  textbookId: string,
  worldId: string = DEFAULT_WORLD_ID,
  profileId: string = DEFAULT_PROFILE_ID
): string {
  return join(textbookDir(dataRoot, textbookId, worldId, profileId), 'source.pdf')
}
```

- [ ] **Step 5: store 实现**（`src/main/storage/textbook-store.ts`）

顶部 import 增加 `copyFile` 和 `textbookOriginalPath`：

```typescript
import { mkdir, writeFile, readFile, access, readdir, unlink, copyFile } from 'node:fs/promises'
import {
  textbooksDir,
  textbookDir,
  textbookPath,
  textbookContentPath,
  textbookOriginalPath
} from './app-data'
```

`CreateTextbookInput` 增加字段：

```typescript
export interface CreateTextbookInput {
  worldId: WorldId
  title: string
  format: 'markdown' | 'text' | 'pdf' | 'epub'
  /** 原始文件名（仅展示用，不再是绝对路径） */
  sourceFile?: string
  content?: string
  /** 原件在磁盘上的来源路径；提供时 store 会复制为教材目录下的 source.pdf */
  originalSourcePath?: string
}
```

`create()` 的 `raw` 对象增加 `originalFile`，方法末尾（`return textbook` 前）增加复制逻辑：

```typescript
    const raw: Record<string, unknown> = {
      id,
      worldId: input.worldId,
      title: input.title,
      format: input.format,
      sourceFile: input.sourceFile ?? '',
      originalFile: input.originalSourcePath ? 'source.pdf' : '',
      content: input.content ?? '',
      progress: { currentPage: 0, totalPages: null },
      createdAt: now,
      updatedAt: now
    }
```

在 `if (input.content) { ... }` 块之后、`return textbook` 之前插入：

```typescript
    if (input.originalSourcePath) {
      await copyFile(
        input.originalSourcePath,
        textbookOriginalPath(this.dataRoot, id, input.worldId)
      )
    }
```

类末尾（`getContent` 之后）新增方法：

```typescript
  /**
   * Read the stored original file (source.pdf) for a textbook.
   * Returns null when the textbook has no original or does not exist.
   * fileName is the display name (basename of the imported file).
   */
  async readOriginal(
    textbookId: string,
    worldId: string
  ): Promise<{ data: Buffer; fileName: string } | null> {
    const tb = await this.get(textbookId, worldId)
    if (!tb || !tb.originalFile) return null

    try {
      const data = await readFile(
        join(textbookDir(this.dataRoot, textbookId, worldId), tb.originalFile)
      )
      const fileName = tb.sourceFile.split(/[/\\]/).pop() || tb.originalFile
      return { data, fileName }
    } catch {
      return null
    }
  }
```

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run tests/main/storage/textbook-store`
Expected: 6 passed

- [ ] **Step 7: Commit**

```bash
git add src/shared/schemas/textbook.ts src/main/storage/app-data.ts src/main/storage/textbook-store.ts tests/main/storage/textbook-store.test.ts
git commit -m "feat: textbook store keeps original PDF (copy on import, readOriginal)"
```

---

### Task 2: IPC——导入复制原件 + read-original 通道

**Files:**
- Modify: `src/main/ipc/data.ts`

**Interfaces:**
- Consumes: `TextbookStore.readOriginal`、`CreateTextbookInput.originalSourcePath`（Task 1）
- Produces: IPC 通道 `textbook:read-original`，入参 `{ textbookId: string; worldId?: string }`，返回 `{ data: Uint8Array; fileName: string } | null`（Buffer 经 IPC 到渲染端变为 Uint8Array）；超过 100MB 抛错

- [ ] **Step 1: 修改 `textbook:create`**（`src/main/ipc/data.ts` 现有 handler 的 `return textbookStore.create({...})` 处）

将原来的：

```typescript
    return textbookStore.create({
      worldId: parsed.worldId as WorldId,
      title: parsed.title,
      format: parsed.format,
      sourceFile: parsed.sourceFile,
      content
    })
```

改为：

```typescript
    return textbookStore.create({
      worldId: parsed.worldId as WorldId,
      title: parsed.title,
      format: parsed.format,
      // sourceFile 只保留文件名作展示（不再依赖绝对路径）
      sourceFile: parsed.sourceFile?.split(/[/\\]/).pop() ?? parsed.sourceFile,
      content,
      // PDF 原件随导入保存（sourceFile 已通过 PickedFileRegistry 校验）
      originalSourcePath:
        parsed.format === 'pdf' && parsed.sourceFile ? parsed.sourceFile : undefined
    })
```

- [ ] **Step 2: 新增 `textbook:read-original` handler**（放在 `textbook:get` handler 之后）

```typescript
  ipcMain.handle('textbook:read-original', async (_event, input: unknown) => {
    const parsed = input as { textbookId: string; worldId?: string }
    const worldId = parsed.worldId ?? 'world_default'
    const result = await textbookStore.readOriginal(parsed.textbookId, worldId)
    if (!result) return null
    if (result.data.length > MAX_ORIGINAL_SIZE) {
      throw new Error('原件超过 100MB，无法在应用内打开')
    }
    return { data: result.data, fileName: result.fileName }
  })
```

文件顶部（import 之后）加常量：

```typescript
/** In-app reader loads the whole file into memory — cap it. */
const MAX_ORIGINAL_SIZE = 100 * 1024 * 1024
```

- [ ] **Step 3: typecheck + 全量测试**

Run: `npm run typecheck && npx vitest run`
Expected: 0 errors，全部通过

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/data.ts
git commit -m "feat: save PDF original on import, add textbook:read-original IPC"
```

---

### Task 3: 同步二进制通道

**Files:**
- Modify: `src/main/sync/webdav-client.ts`
- Modify: `src/main/sync/sync-manager.ts`
- Test: `tests/main/sync/sync-manager.test.ts`

**Interfaces:**
- Consumes: 无（独立）
- Produces:
  - `SyncWebDavClient.uploadFile(remotePath: string, content: string | Buffer): Promise<void>`
  - `SyncWebDavClient.downloadFileBuffer(remotePath: string): Promise<Buffer>`
  - sync-manager 内部：`isBinaryFile(relPath: string): boolean`（`.pdf` 为二进制）

- [ ] **Step 1: 追加失败测试**（`tests/main/sync/sync-manager.test.ts`，在文件末尾 `})` 之前加新的 describe）

```typescript
describe('SyncManager — binary files (.pdf)', () => {
  const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80, 0x7f, 0x0a, 0x0d])

  it('pushes .pdf files as binary and pulls them back byte-identical', async () => {
    const relPdf = join(
      'profiles', 'prof_default', 'worlds', 'world_default',
      'textbooks', 'tb_1', 'source.pdf'
    )
    await mkdir(join(dataRoot, 'profiles', 'prof_default', 'worlds', 'world_default', 'textbooks', 'tb_1'), { recursive: true })
    await writeFile(join(dataRoot, relPdf), PDF_BYTES)

    const fake = new FakeClient()
    await makeManager(dataRoot, fake).push(CONFIG)

    expect(fake.uploads).toHaveLength(1)
    expect(fake.uploads[0].path).toBe('/sophia/profiles/prof_default/worlds/world_default/textbooks/tb_1/source.pdf')
    // Content must be the raw bytes, not a utf-8-decoded string
    const uploaded = fake.uploads[0].content
    const uploadedBuf = Buffer.isBuffer(uploaded) ? uploaded : Buffer.from(uploaded as string, 'utf-8')
    expect(uploadedBuf.equals(PDF_BYTES)).toBe(true)

    // Round-trip: pull into a fresh dataRoot
    await rm(join(dataRoot, relPdf))
    fake.remoteFiles = [fake.uploads[0].path]
    fake.remoteBuffers.set(fake.uploads[0].path, uploadedBuf)

    const result = await makeManager(dataRoot, fake).pull(CONFIG)
    expect(result.count).toBe(1)

    const pulled = await readFile(join(dataRoot, relPdf))
    expect(pulled.equals(PDF_BYTES)).toBe(true)
  })
})
```

同时把 `FakeClient` 升级为支持二进制（替换现有 FakeClient 类）：

```typescript
class FakeClient {
  uploads: { path: string; content: string | Buffer }[] = []
  ensuredDirs: string[] = []
  remoteFiles: string[] = []
  remoteContents = new Map<string, string>()
  remoteBuffers = new Map<string, Buffer>()

  async uploadFile(path: string, content: string | Buffer): Promise<void> {
    this.uploads.push({ path, content })
  }
  async ensureDir(dir: string): Promise<void> {
    this.ensuredDirs.push(dir)
  }
  async listAllFiles(_dir: string): Promise<string[]> {
    return this.remoteFiles
  }
  async downloadFile(path: string): Promise<string> {
    const content = this.remoteContents.get(path)
    if (content === undefined) throw new Error(`no such remote file: ${path}`)
    return content
  }
  async downloadFileBuffer(path: string): Promise<Buffer> {
    const content = this.remoteBuffers.get(path)
    if (content === undefined) throw new Error(`no such remote file: ${path}`)
    return content
  }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/main/sync`
Expected: 新二进制测试 FAIL（当前 push 按 utf-8 读、pull 无 downloadFileBuffer，字节被破坏/报类型错误）

- [ ] **Step 3: webdav-client 放宽上传 + 新增二进制下载**（`src/main/sync/webdav-client.ts`）

```typescript
  async uploadFile(remotePath: string, content: string | Buffer): Promise<void> {
    await this.client.putFileContents(remotePath, content, {
      overwrite: true
    })
  }

  async downloadFileBuffer(remotePath: string): Promise<Buffer> {
    const data = await this.client.getFileContents(remotePath, {
      format: 'binary'
    })
    return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
  }
```

- [ ] **Step 4: sync-manager 按扩展名走二进制**（`src/main/sync/sync-manager.ts`）

顶部 import 加 `extname`：

```typescript
import { dirname, join, extname } from 'node:path'
```

`isSafeRelativePath` 之后加：

```typescript
/** Extensions synced as raw bytes instead of utf-8 text. */
const BINARY_EXTENSIONS = new Set(['.pdf'])

function isBinaryFile(relPath: string): boolean {
  return BINARY_EXTENSIONS.has(extname(relPath).toLowerCase())
}
```

push 循环里，把：

```typescript
        const content = await readFile(file.localPath, 'utf-8')
```

改为：

```typescript
        const content = isBinaryFile(file.relativePath)
          ? await readFile(file.localPath)
          : await readFile(file.localPath, 'utf-8')
```

pull 循环里，把：

```typescript
        const content = await client.downloadFile(remotePath)
        // Ensure local directory exists
        await mkdir(dirname(localPath), { recursive: true })
        await writeFile(localPath, content, 'utf-8')
```

改为（writeFile 对 string 默认 utf-8、对 Buffer 原样写入，无需区分编码参数）：

```typescript
        const content = isBinaryFile(relPath)
          ? await client.downloadFileBuffer(remotePath)
          : await client.downloadFile(remotePath)
        // Ensure local directory exists
        await mkdir(dirname(localPath), { recursive: true })
        await writeFile(localPath, content)
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/main/sync`
Expected: 全部通过（含既有文本用例）

- [ ] **Step 6: Commit**

```bash
git add src/main/sync/webdav-client.ts src/main/sync/sync-manager.ts tests/main/sync/sync-manager.test.ts
git commit -m "feat: binary sync channel for .pdf originals (byte-identical round-trip)"
```

---

### Task 4: preload 与渲染端类型

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/types/global.d.ts`

**Interfaces:**
- Consumes: IPC `textbook:read-original`（Task 2）
- Produces: `window.sophia.data.readTextbookOriginal(textbookId: string, worldId?: string): Promise<{ data: Uint8Array; fileName: string } | null>`；`TextbookDTO.originalFile: string`

- [ ] **Step 1: `src/preload/index.ts` 三处修改**

`TextbookDTO` 在 `sourceFile: string` 后加：

```typescript
  originalFile: string
```

`DataAPI` 在 `getTextbook` 一行后加：

```typescript
  readTextbookOriginal: (textbookId: string, worldId?: string) => Promise<{ data: Uint8Array; fileName: string } | null>
```

`data` 实现对象中 `getTextbook` 一行后加：

```typescript
    readTextbookOriginal: (textbookId, worldId) => ipcRenderer.invoke('textbook:read-original', { textbookId, worldId }),
```

- [ ] **Step 2: `src/renderer/src/types/global.d.ts` 同步两处**

`TextbookDTO` 加 `originalFile: string`（位置同 preload）；`DataAPI`（或 data 相关 interface）加与上面相同的 `readTextbookOriginal` 签名。

注意：global.d.ts 中该接口可能叫 `DataAPI` 或内联在 `SophiaAPI.data` 里——以实际代码为准，保持与 preload 一致。

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/src/types/global.d.ts
git commit -m "feat: expose readTextbookOriginal and TextbookDTO.originalFile to renderer"
```

---

### Task 5: PdfReaderView 组件 + 教材列表入口

**Files:**
- Create: `src/renderer/src/reader/PdfReaderView.tsx`
- Modify: `src/renderer/src/App.tsx`（本地 `interface Textbook`、TextbooksView）
- 可能 Modify: `src/renderer/src/chat/ClassroomView.tsx`（若其本地 `interface Textbook` 字段不足，仅当 typecheck 报错时）

**Interfaces:**
- Consumes: `window.sophia.data.readTextbookOriginal`、`TextbookDTO.originalFile`（Task 4）
- Produces: `<PdfReaderView textbookId title onClose />` 全屏覆盖组件

- [ ] **Step 1: 确认 pdfjs v6 render 参数形态**

Run: `grep -n "canvas" node_modules/pdfjs-dist/types/src/display/api.d.ts | head -20`

查看 `RenderParameters` 定义——若字段是 `canvasContext` 用 canvasContext；若 v6 已改为 `canvas`，下面的 `page.render({...})` 对应改为 `{ canvas, viewport }`。

- [ ] **Step 2: 创建 `src/renderer/src/reader/PdfReaderView.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface PdfReaderViewProps {
  textbookId: string
  title: string
  onClose: () => void
}

export function PdfReaderView({ textbookId, title, onClose }: PdfReaderViewProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.5)
  const [error, setError] = useState('')

  // Load the document once
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await window.sophia.data.readTextbookOriginal(textbookId)
        if (cancelled) return
        if (!result) {
          setError('该教材没有原件')
          return
        }
        const loaded = await pdfjs.getDocument({ data: result.data }).promise
        if (cancelled) return
        setDoc(loaded)
        setPageCount(loaded.numPages)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [textbookId])

  // Render current page
  useEffect(() => {
    if (!doc || !canvasRef.current) return
    let cancelled = false
    ;(async () => {
      const page = await doc.getPage(pageNum)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current!
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')!
      // pdfjs v6: 若 RenderParameters 使用 canvas 字段，改为 { canvas, viewport }
      await page.render({ canvasContext: ctx, viewport }).promise
    })()
    return () => {
      cancelled = true
    }
  }, [doc, pageNum, scale])

  const fitWidth = async () => {
    if (!doc || !containerRef.current) return
    const page = await doc.getPage(pageNum)
    const base = page.getViewport({ scale: 1 })
    setScale((containerRef.current.clientWidth - 32) / base.width)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-deep">
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-2">
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            disabled={pageNum <= 1}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-xs text-text-secondary">
            {pageNum} / {pageCount || '…'}
          </span>
          <button
            onClick={() => setPageNum((p) => Math.min(pageCount, p + 1))}
            disabled={pageNum >= pageCount}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated disabled:opacity-50"
          >
            下一页
          </button>
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
          >
            −
          </button>
          <button
            onClick={() => setScale((s) => Math.min(4, s + 0.25))}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
          >
            +
          </button>
          <button
            onClick={fitWidth}
            className="rounded border border-surface-border-strong px-2 py-1 text-xs hover:bg-bg-elevated"
          >
            适应宽度
          </button>
          <button
            onClick={onClose}
            className="rounded border border-surface-border-strong px-3 py-1 text-xs text-red-400 hover:bg-red-900/30"
          >
            关闭
          </button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 overflow-auto p-4 text-center">
        {error ? (
          <p className="mt-8 text-sm text-red-400">{error}</p>
        ) : (
          <canvas ref={canvasRef} className="mx-auto shadow-lg" />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: App.tsx 接入**

`src/renderer/src/App.tsx` 顶部 import 区加：

```typescript
import { PdfReaderView } from './reader/PdfReaderView'
```

本地 `interface Textbook`（第 16 行附近）在 `sourceFile: string` 后加：

```typescript
  originalFile: string
```

TextbooksView 组件内 state 区加：

```typescript
  const [readingTextbook, setReadingTextbook] = useState<Textbook | null>(null)
```

教材列表按钮区（"查看"按钮之前）加：

```tsx
              {t.originalFile && (
                <button
                  onClick={() => setReadingTextbook(t)}
                  className="rounded border border-surface-border-strong px-3 py-1 text-sm hover:bg-bg-elevated"
                >
                  阅读原件
                </button>
              )}
```

TextbooksView 的 return 最外层 `<div className="p-8">` 内末尾（`</div>` 闭合前）加：

```tsx
      {readingTextbook && (
        <PdfReaderView
          textbookId={readingTextbook.id}
          title={readingTextbook.title}
          onClose={() => setReadingTextbook(null)}
        />
      )}
```

- [ ] **Step 4: typecheck + 构建**

Run: `npm run typecheck && npm run build`
Expected: 0 errors；构建成功，renderer 产物中出现 pdf 相关 chunk

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/reader/PdfReaderView.tsx src/renderer/src/App.tsx
git commit -m "feat: in-app PDF reader for textbook originals"
```

---

### Task 6: 全量验证 + 打包实测

**Files:** 无（验证任务）

- [ ] **Step 1: 全量检查**

Run: `npm run typecheck && npx vitest run && node scripts/verify-security.mjs`
Expected: 0 type errors；全部测试通过；security baseline passed

- [ ] **Step 2: 打包**

Run: `npm run build:win`
Expected: 生成 `release/SophiaLocal Setup 0.1.0.exe`

- [ ] **Step 3: 手动实测**（用户操作清单）

1. 覆盖安装后导入一个 PDF 教材 → 教材列表出现"阅读原件"按钮
2. 点击"阅读原件" → 全屏阅读器打开，翻页/缩放/适应宽度正常
3. Push → 服务器 `/sophia/profiles/prof_default/worlds/world_default/textbooks/tb_xxx/source.pdf` 存在且大小一致
4. 删除本地数据目录中该教材后 Pull → 原件恢复且能正常打开阅读

---

## Self-Review 记录

- Spec 覆盖：存储(Task 1)、导入(Task 2)、阅读器(Task 5)、IPC/preload(Task 2/4)、同步二进制(Task 3)、兼容(schema default, Task 1)、测试(各 Task + Task 6) ✓
- 类型一致性：`readOriginal` 返回 `{ data: Buffer; fileName: string } | null`（Task 1 定义）→ IPC 透传（Task 2）→ preload 类型 `{ data: Uint8Array; fileName: string }`（Task 4，Buffer 跨 IPC 即 Uint8Array）✓；`originalSourcePath` 命名在 Task 1/2 一致 ✓；`isBinaryFile`/`downloadFileBuffer` 命名在 Task 3 内一致 ✓
- 无占位符：所有代码步骤含完整代码 ✓
