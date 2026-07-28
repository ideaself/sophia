# 教材原件保存与 PDF 阅读器设计

日期：2026-07-28
状态：已批准（方案 A）

## 背景与目的

当前教材导入只保留解析后的纯文本（`source.md`），`textbook.json` 里的 `sourceFile` 是原电脑绝对路径，同步到其他机器后无意义，且软件内无法查看教材原版内容。扫描件、公式、图表在解析文本中全部丢失。

目标：

1. 导入 PDF 时把原件复制进数据目录保存
2. 应用内可阅读 PDF 原件（独立阅读页面）
3. 原件随 WebDAV 同步到其他设备

非目标（第一期）：EPUB 原件阅读、批注/目录/搜索、课堂侧边栏阅读、旧教材原件自动迁移。

## 1. 数据结构与存储

- 原件统一存为 `textbooks/tb_xxx/source.pdf`（与 `source.md` 并列，固定文件名；渲染端永不传路径，杜绝目录穿越）
- `textbook.json` 新增 `originalFile: string`：有原件为 `'source.pdf'`，无原件为 `''`（zod schema 默认值 `''`，向后兼容旧数据）
- 现有 `sourceFile` 字段语义降级：只存原始文件名（如 `高等数学.pdf`）作展示，不再存绝对路径
- 删除教材时现有逻辑删除整个目录，原件随之清理，无需改动

## 2. 导入流程

- 渲染端导入流程不变（对话框选文件 → `data.createTextbook`）
- 主进程 `textbook:create`：pdf 格式时在解析文本之外，将已通过 `PickedFileRegistry` 校验的原件 `copyFile` 到教材目录
- markdown/text 导入无原件概念，`originalFile` 记 `''`

## 3. 阅读器

- 新 IPC `textbook:read-original`：参数 `{textbookId, worldId}`，主进程按固定文件名读 `textbooks/tb_xxx/source.pdf`，返回 `{ data: Uint8Array, fileName }`；无原件返回 `null`；原件超过 100MB 返回错误
- 新组件 `PdfReaderView`：教材列表"阅读原件"按钮进入的全屏阅读页；`pdfjs-dist` 的 `getDocument({ data })` 逐页渲染 canvas；控件仅翻页、页码显示、缩放（+ / − / 适应宽度）、关闭
- worker 配置：`pdfjs-dist/build/pdf.worker.min.mjs?url` 赋给 `GlobalWorkerOptions.workerSrc`
- 无原件的教材条目不显示阅读按钮

## 4. 同步二进制

现状：push/pull 全部按 utf-8 文本读写，二进制文件会损坏。

- `sync-manager`：按扩展名区分，`.pdf` 用二进制 `readFile`（不传编码 → Buffer）上传，pull 时对应写 Buffer；其余文件维持文本路径
- `webdav-client`：`uploadFile` 参数放宽为 `string | Buffer`；`downloadFile` 增加二进制分支（`format: 'binary'`）
- `file-walker` 不改（`.pdf` 不在排除规则内）
- WebDAV 服务体积/流量限制导致的失败按现有机制计入 `errors` 展示，不额外处理

## 5. 旧数据兼容

- 旧 `textbook.json` 无 `originalFile` 字段 → schema 默认 `''`，阅读按钮不出现
- 旧记录 `sourceFile` 的绝对路径原样保留（仅展示，无功能依赖）
- 不做自动迁移复制旧原件；需要原件时重新导入

## 6. 测试

- `textbook-store`：带原件创建 → `source.pdf` 落盘且 `originalFile` 正确；`readOriginal` 返回字节；无原件返回 `null`
- `sync-manager`：`.pdf` push → pull 往返字节级一致（fake client + 临时文件）
- 文本文件同步行为不变（现有测试守住）
- 阅读器 UI 无单测，打包后用真实 PDF 手动验证翻页/缩放

## 涉及文件

- `src/shared/schemas/textbook.ts`（新增 originalFile 字段）
- `src/main/storage/textbook-store.ts`（原件复制、readOriginal）
- `src/main/storage/app-data.ts`（原件路径辅助，如需）
- `src/main/ipc/data.ts`（textbook:create 复制原件、textbook:read-original 通道）
- `src/preload/index.ts`、`src/renderer/src/types/global.d.ts`（API 类型）
- `src/renderer/src/App.tsx` 或新组件文件（PdfReaderView、阅读按钮）
- `src/main/sync/sync-manager.ts`、`src/main/sync/webdav-client.ts`（二进制通道）
- 测试：`tests/main/storage/textbook-store.test.ts`（新）、`tests/main/sync/sync-manager.test.ts`（加二进制用例）
