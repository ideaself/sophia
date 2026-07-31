# Sophia-Local 优化计划 v3

> 基于 2026-07-30 深度代码审查 + 参考设计（Sophia v2.1.1 调研）对比分析。
> plan.md (v1) 和 plan-v2.md 的所有项目均已完成。
> 进度标记：[ ] 待办  [~] 进行中  [x] 已完成

---

## A. 参考设计中缺失的核心学习系统（影响最大）

参考设计描述了多个系统，当前实现完全缺失。这些是产品完整性的核心缺口。

### A1. 学习者画像更新（Learner Profile Updates）
- **现状**：`learner.md` 初始化为空字符串（`initialize.ts:99`），从未被填充。它被读取（`world-store.ts:42-45`）并注入 prompt（`chat-prompt.ts:61`），但始终为空。
- **参考**：`reference/文件布局/file-layout.md:78-82` -- AI 对学习者的持续评估（认知水平、薄弱点、学习习惯），每次下课时更新。
- **实现思路**：
  1. 下课流程中新增 artifact 类型或直接生成学习者画像更新内容
  2. 写入 `learner.md`（通过 `learnerPath()` 已有路径函数）
  3. 下次课堂自动注入 system prompt（注入逻辑已存在于 `prompt-builder.ts:192-194`，只是数据为空）
- **涉及文件**：`generate.ts`、`data.ts`（conversation:end handler）、`world-store.ts`（新增 write 方法）
- **状态**: [x]

### A2. Pal Moments（互动备忘）
- **现状**：完全缺失。没有存储、没有生成、没有注入。
- **参考**：`reference/文件布局/file-layout.md:84-89` + `reference/prompt-结构/end-class-format.md:45-51` -- 跨会话记忆，记录教学互动（学习者难点、伙伴讲解、关键问答、突破时刻）。下课时生成，下次课堂注入 system prompt。
- **格式**：`## YYYY-MM-DD | 伙伴名` + 内容段，追加合并到 `pal_moments.md`
- **实现思路**：
  1. 在 `ids.ts` 新增 `ArtifactType.PalMoments`
  2. 在 `generate.ts` 添加生成 prompt
  3. 新增存储：写入 `pal_moments.md`（需在 `app-data.ts` 添加路径函数）
  4. 在 `chat-prompt.ts` 加载并注入到 `buildMessages`
  5. 在 `prompt-builder.ts` 新增 `buildPalMomentsSegment`
- **涉及文件**：`ids.ts`、`generate.ts`、`app-data.ts`、`chat-prompt.ts`、`prompt-builder.ts`
- **状态**: [x]

### A3. 关系状态（Relationship State）
- **现状**：完全缺失。
- **参考**：`reference/文件布局/file-layout.md:102-106` -- `relation_npc_{a|b|c}.md`，≤150 tokens，记录 companion 与学习者的关系变化。下课时更新，上课时注入。
- **实现思路**：
  1. 在 `ids.ts` 新增 `ArtifactType.Relation`
  2. 在 `generate.ts` 添加生成 prompt（≤150 tokens）
  3. 存储到 `relation_npc_{slot}.md`（需要知道 companion 的 slot A/B/C）
  4. 在 `chat-prompt.ts` 加载并注入
- **涉及文件**：`ids.ts`、`generate.ts`、`app-data.ts`、`chat-prompt.ts`、`prompt-builder.ts`
- **状态**: [x]

### A4. Companion 内心独白（Companion Note）
- **现状**：7 段下课格式中缺失的一段。
- **参考**：`reference/prompt-结构/end-class-format.md:75-81` -- ≤80 字符的 companion 内心独白，不展示给学习者但用于内部状态。"最容易漏的一段"。
- **实现思路**：
  1. 在 `ids.ts` 新增 `ArtifactType.CompanionNote`
  2. 在 `generate.ts` 添加生成 prompt（≤80 字符）
  3. 存储为 artifact，可用于后续分析
- **涉及文件**：`ids.ts`、`generate.ts`
- **状态**: [x]

### A5. 下课告别语（Farewell Message）
- **现状**：下课时没有告别语。用户只看到 "课程已结束" 的 UI 提示（`ClassroomView.tsx:591-598`）。
- **参考**：`reference/prompt-结构/end-class-format.md:39-43` -- AI 应生成一段告别语展示给学习者。
- **实现思路**：
  1. 在 `ids.ts` 新增 `ArtifactType.Farewell`
  2. 在 `generate.ts` 添加生成 prompt
  3. 在 `data.ts` conversation:end 返回告别语内容
  4. 在 `ClassroomView.tsx` 展示告别语（替代或补充当前的 "课程已结束" 提示）
- **涉及文件**：`ids.ts`、`generate.ts`、`data.ts`、`ClassroomView.tsx`
- **状态**: [x]

---

## B. 教学增强功能（中等影响）

### B1. 教材内容自动推进
- **现状**：教学教练分析包含 `contentProgress: "first_half" | "second_half"`（`teaching-coach.ts:65,262`），但没有任何代码根据此信号采取行动。
- **参考**：`reference/prompt-结构/teaching-coach.md:143-148` -- 当 `contentProgress === "second_half"` 且阅读窗口过半时，触发教材内容自动读取 + 半场摘要。
- **实现思路**：
  1. 在 `chat-prompt.ts` 中检测教练评估的 `contentProgress`
  2. 当进入后半段时，注入更多教材内容（扩大 `maxTextbookTokens` 或加载下一章节）
  3. 可选：生成 200-300 token 的半场摘要注入 prompt
- **涉及文件**：`chat-prompt.ts`、`prompt-builder.ts`
- **状态**: [x]

### B2. DeepSeek Thinking Mode
- **现状**：技术调查（`docs/产品设计/技术调查.md:138-148`）建议课堂对话使用 `deepseek-v4-pro` + thinking enabled，但未实现。
- **参考**：`{"thinking": {"type": "enabled"}}`，`reasoning_content` 不直接展示给用户（除非设计"思考过程"视图）。
- **实现思路**：
  1. 在 `deepseek-stream-adapter.ts` 的请求 body 中添加 `thinking` 参数
  2. 在 SSE 解析中处理 `reasoning_content` 字段（与 `content` 分离）
  3. 可选：在 UI 中展示"思考中..."状态或折叠的思考过程
  4. 在设置中添加开关（课堂追问启用 thinking，摘要/闪卡禁用以降低成本）
- **涉及文件**：`deepseek-stream-adapter.ts`、`stream-types.ts`、`stream-chat.ts`、`chat-stream.ts`、`useChatStream.ts`、`SettingsView.tsx`
- **状态**: [x]

### B3. 日记月度文件
- **现状**：日记作为 artifact 存储在 artifact store 中，不是 `diary/YYYY-MM.md` 月度文件。
- **参考**：`reference/文件布局/file-layout.md:97-100` + `reference/prompt-结构/end-class-format.md:62-67` -- 按月聚合，`---` 分隔，可在历史中浏览。
- **实现思路**：
  1. 新增 `DiaryStore`，下课时追加到 `diary/YYYY-MM.md`
  2. 在 `app-data.ts` 添加 `diaryDir()` 和 `diaryPath()` 路径函数
  3. 新增 IPC `diary:list-entries` 和 `diary:get-month`
  4. 可选：在历史视图或新页面中展示日记时间线
- **涉及文件**：新增 `diary-store.ts`、`app-data.ts`、`data.ts`、`preload/index.ts`
- **状态**: [x]

---

## C. UX 功能（中等影响，可行性高）

### C1. 键盘快捷键
- **现状**：无快捷键（除了 Enter 发送）。
- **参考**：`docs/产品设计/技术调查.md:35` -- v3.2.0 有全局键盘快捷键。
- **实现思路**：在 `ClassroomView.tsx` 和 `App.tsx` 添加 `useEffect` 键盘监听：
  - `Ctrl+T`：新建标签页
  - `Ctrl+W`：关闭当前标签页
  - `Ctrl+Tab` / `Ctrl+Shift+Tab`：切换标签页
  - `Ctrl+K`：聚焦搜索（历史视图）
  - `Escape`：关闭模态框/下拉菜单
- **涉及文件**：`ClassroomView.tsx`、`App.tsx`、`HistoryView.tsx`
- **状态**: [x]

### C2. 消息虚拟化
- **现状**：`ClassroomView.tsx:561` 长对话全量渲染，100+ 消息可能卡顿。
- **实现思路**：
  1. 安装 `react-window` 或 `@tanstack/react-virtual`
  2. 将消息列表改为虚拟化滚动
  3. 注意：流式消息（`streaming` id）需要特殊处理
- **涉及文件**：`ClassroomView.tsx`、`package.json`
- **状态**: [x]

### C3. 批量导出
- **现状**：`HistoryView.tsx` 仅支持单条导出（`handleExport`，line 147-182）。
- **实现思路**：
  1. 添加"全选"checkbox 和"导出选中"按钮
  2. 或添加"按月导出"功能，将一个月内所有对话合并为一个 Markdown 文件
- **涉及文件**：`HistoryView.tsx`
- **状态**: [x]

### C4. 对话内搜索
- **现状**：全局搜索存在（`HistoryView.tsx`），但无法在单个对话内搜索。
- **实现思路**：
  1. 在 `ClassroomView.tsx` 添加 `Ctrl+F` 搜索栏
  2. 高亮匹配的消息并滚动到位置
  3. 可复用现有的 `searchMessages` IPC（传 conversationId 过滤）
- **涉及文件**：`ClassroomView.tsx`
- **状态**: [x]

### C5. TTS 增强回放控制
- **现状**：`ChatMessage.tsx:72-126` 和 `EpubReaderView.tsx:150-166` 有基础 TTS（播放/停止）。
- **参考**：`docs/产品设计/技术调查.md:35` -- v3.2.0 有进度条、暂停/恢复、循环、速度控制。
- **实现思路**：
  1. 将 TTS 逻辑提取为 `useTTS` hook
  2. 添加速度控制（`utter.rate` 滑块）
  3. 使用 `utter.onboundary` 事件跟踪进度
  4. 添加暂停/恢复（`speechSynthesis.pause()` / `resume()`）
- **涉及文件**：新增 `hooks/useTTS.ts`、`ChatMessage.tsx`、`EpubReaderView.tsx`
- **状态**: [x]

---

## D. 架构/代码质量（影响较低，可行性高）

### D1. `buildArtifactPrompt` 缺少 default 分支
- **文件**：`generate.ts:97-142`
- **问题**：switch 无 default，新增 ArtifactType 时静默返回 undefined，`client.chat()` 会收到 undefined 作为 system prompt。
- **实现思路**：添加 exhaustive check：
  ```typescript
  default: {
    const _exhaustive: never = type
    throw new Error(`Unknown artifact type: ${_exhaustive}`)
  }
  ```
- **状态**: [x]

### D2. `generateArtifacts` 并行调用 5 次 LLM
- **文件**：`generate.ts:50-63`
- **问题**：5 个 artifact 类型并行调用 `Promise.allSettled`，可能触发 rate limit（429）。
- **实现思路**：限制并发数为 2-3（用简单的 chunk 分批或 semaphore）。
- **状态**: [x]

### D3. React Error Boundary
- **现状**：无 Error Boundary，渲染错误会白屏。
- **实现思路**：
  1. 新增 `ErrorBoundary` 组件
  2. 在 `App.tsx` 包裹 `<main>` 内容
  3. 展示错误信息 + "重新加载"按钮
- **涉及文件**：新增 `components/ErrorBoundary.tsx`、`App.tsx`
- **状态**: [x]

### D4. Handoff 元数据缺失
- **文件**：`generate.ts`、`chat-prompt.ts:193-216`
- **问题**：只存储 handoff tail 内容，不存储结构化元数据（prevConvId、endingPage、companionSlot）。
- **参考**：`reference/文件布局/file-layout.md:114-124` -- `handoff_meta.json`
- **实现思路**：下课时额外存储 `{ savedAt, prevConvId, companionName, companionSlot, endingPage }` 到 `handoff_meta.json`，加载时用元数据精确匹配而非仅靠 companionId + 时间排序。
- **状态**: [x]

---

## 建议实施顺序

| 批次 | 项目 | 理由 |
|------|------|------|
| 第 1 批 | A1 + A5 + D1 | 学习者画像 + 告别语 + exhaustive check -- 最小改动、补全核心闭环 |
| 第 2 批 | A2 + A3 + A4 | Pal Moments + 关系状态 + 内心独白 -- 补全 7 段下课格式 |
| 第 3 批 | C1 + D3 | 键盘快捷键 + Error Boundary -- 投入产出比最高的 UX 改进 |
| 第 4 批 | B1 | 教材内容自动推进 -- 提升教学质量 |
| 第 5 批 | B3 + C3 | 日记月度文件 + 批量导出 -- 数据组织改进 |
| 第 6 批 | C2 + C4 + C5 | 消息虚拟化 + 对话内搜索 + TTS 增强 -- 性能与体验打磨 |
| 第 7 批 | B2 + D2 + D4 | Thinking mode + 并发限制 + Handoff 元数据 -- 高级功能 |
