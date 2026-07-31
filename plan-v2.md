# Sophia-Local 优化计划 v2

> 基于 2026-07-30 全量代码审查。plan.md 中所有项目已完成，以下为新发现的优化点。
> 进度标记：[ ] 待办  [~] 进行中  [x] 已完成

---

## P0 - 关键 Bug

### 1. 流式请求无自动重试 (429/500/503)
- **文件**: `src/main/llm/deepseek-stream-adapter.ts`
- **问题**: 非流式 `DeepSeekClient.chat()` 对 429/500/503 有指数退避重试（`deepseek-client.ts:84`），但流式路径 `createDeepSeekStreamAdapter` 在非 2xx 时直接 `throw mapDeepSeekError()`，没有任何重试。用户在对话中被限流只能手动点"重试"。
- **修复**: 在 `streamChat` 的 `fetchImpl()` 外层包一层重试逻辑：遇到 `retryable=true` 的 AppError 时退避重试（最多 2 次，1s/2s）。注意只能在首个 chunk 收到前重试（一旦开始流式输出就不能重试了）。
- **状态**: [x]

---

## P1 - 重要改进

### 2. chat-prompt IPC 未用 Zod 校验
- **文件**: `src/main/ipc/chat-prompt.ts:30-48`
- **问题**: `chat:get-prompt-messages` 用手写 `validateInput()` 做类型检查，而其他所有 IPC handler 都已统一用 Zod schema。不一致且校验更弱。
- **修复**: 在 `shared/schemas/ipc.ts` 新增 `IpcChatPromptMessagesInputSchema`，替换手写校验。
- **状态**: [x]

### 3. file:writeText 接受任意路径
- **文件**: `src/main/ipc/data.ts:422-427`
- **问题**: `file:writeText` handler 直接写 `parsed.filePath` 指向的文件，不检查路径是否来自原生保存对话框。若渲染进程被 XSS（如 EPUB 内容注入），攻击者可写任意文件。
- **修复**: 像 `pickedFiles` 注册表一样，维护一个 `savedFilePaths` 集合，`file:writeText` 只允许写入最近通过 `dialog:saveFile` 返回的路径。
- **状态**: [x]

### 4. StatsView 串行加载
- **文件**: `src/renderer/src/components/StatsView.tsx:55-69`
- **问题**: 对 N 个对话做 2N 次串行 IPC 调用（每个对话 `listMessages` + `listArtifacts`）。对话多时很慢。
- **修复**: 用 `Promise.all` 并行化，或限制并发数。
- **状态**: [x]

---

## P2 - 功能增强

### 5. 压缩摘要未缓存
- **文件**: `src/main/ipc/chat-prompt.ts:121-133`
- **问题**: `shouldCompress` 触发时（150+ 消息），每次都重新调用 LLM 压缩相同的早期消息。同一对话每条新消息都重复压缩。
- **修复**: 按 conversationId 缓存摘要，仅在窗口边界变化（新消息进入压缩区）时重新压缩。
- **状态**: [x]

### 6. 闪卡 SRS 状态仅存 localStorage
- **文件**: `src/renderer/src/components/FlashcardReviewView.tsx`
- **问题**: SM-2 间隔重复状态存在 localStorage，不参与 WebDAV 同步。换设备后复习进度丢失。
- **修复**: 将 SRS 状态存入数据层（`flashcard-srs.json`），纳入同步范围。localStorage 作为即时缓存。
- **状态**: [x]

### 7. EPUB 阅读进度仅存 localStorage
- **文件**: `src/renderer/src/reader/EpubReaderView.tsx:22-51`
- **问题**: 阅读进度（章节、字号、滚动位置）存 localStorage，不参与 WebDAV 同步。
- **修复**: 将进度写入 textbook store 的 progress 字段（`lastPosition` 存 JSON，`currentPage`/`totalPages` 存章节进度）。localStorage 作为即时缓存。
- **状态**: [x]

---

## P3 - 未来可选

### 8. 长对话消息虚拟化
- `ClassroomView.tsx:561` - 100+ 消息时全量渲染可能卡顿，可用 react-window 虚拟化。

### 9. 键盘快捷键
- Ctrl+T 新建标签、Ctrl+W 关闭标签、Ctrl+Tab 切换标签。

### 10. 批量导出对话
- HistoryView 仅有单条导出，缺少批量导出。
