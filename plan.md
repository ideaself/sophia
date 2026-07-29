Sophia-Local 项目分析报告

项目现状

\- 424 个测试全部通过，36 项安全检查全部通过

\- 14 个计划任务全部实现，还额外完成了 WebDAV 同步和 PDF 原件阅读器

\- 架构清晰：main / preload / renderer 三层分离，Zod 校验，safeStorage 加密

一、Bug 与代码质量问题

1\. 目录删除失败 Bug（高优先级）

conversation-store.ts:96 — await unlink(dir) 尝试用 unlink 删目录，在 Windows/Linux 上会报错。应改用 rmdir 或 rm：

// 当前（会失败）

await unlink(dir)

// 应改为

import { rm } from 'node:fs/promises'

await rm(dir, { recursive: true })

2\. 消息存储性能问题（中优先级）

conversation-store.ts:116-123 — 每条 addMessage 都 读取整个 JSON 数组 → 追加 → 写回，长对话下 O(n²)。产品规格明确提到"第一版可用单个 messages.jsonl"，应改用 JSONL 追加写入。

3\. 搜索全量扫描（中优先级）

conversation-store.ts:208-223 — searchMessages 加载所有对话的所有消息到内存做 includes() 匹配。对话量大时会很慢。应建轻量索引或至少做懒加载分页。

4\. IPC 输入校验不一致（安全/质量）

data.ts 中部分 handler 用 Zod schema（如 IpcCreateConversationInputSchema.parse），但大量 handler 用 input as { ... } 裸类型断言（如 conversation:update-title、message:update、message:delete、textbook:create、reading-note:\*、artifact:create）。应统一用 Zod 校验。

5\. as any 类型逃逸

\- generate.ts:36 — config.model as any

\- data.ts:101,140,359,361 — conversationId as any、worldId as WorldId、parsed.type as any

6\. 错误静默吞没

\- generate.ts:80 — catch {} 完全静默，失败的 artifact 无日志、无反馈

\- data.ts:105 — conversation:end 的 catch {} 同样静默

\- 用户看不到哪些 artifact 生成失败了

7\. ClassroomView 中的闭包陷阱

\- ClassroomView.tsx:107 — setActiveIdx(tabs.length) 使用 render 时的 tabs.length，异步回调中可能已过期

\- ClassroomView.tsx:351 — setTimeout(() => handleSend(content), 0) 用 setTimeout 绕过状态更新时序，属于 hack

8\. 无 CSP（内容安全策略）

main/index.ts 的 createWindow() 未设置 Content-Security-Policy header，这是 Electron 安全最佳实践。

9\. import 放在文件底部

conversation-store.ts:226 — import { z } from 'zod' 出现在文件末尾，虽 TS 会 hoist，但极不规范。

二、缺失的核心功能

1\. Handoff Tail 未注入（高优先级）

产品规格明确要求"下次课堂可注入 handoff tail"。当前 generateArtifacts 生成了 handoff\_tail artifact，但 chat-prompt.ts 构建下节课的 prompt 时 完全没有加载和注入它。这意味着下课生成的接力尾巴从未被使用，跨课堂连续性断裂。

修复方向：在 chat-prompt.ts 中，查找同 companion + 同 textbook 的最近已结束对话的 handoff\_tail artifact，注入到 buildMessages 的 learnerInfo 或新增 handoffTail 参数中。

2\. 闪卡复习系统（中优先级）

闪卡（flashcards）在下课时生成并存储，但 没有任何 UI 让用户复习闪卡。这是学习闭环的重要一环——生成了却不让用。

3\. 学习统计/仪表盘（中优先级）

实施计划将"学习统计图表"列为后置项。当前只有历史列表和基础搜索，没有：

\- 学习时长统计

\- 对话次数趋势

\- 知识点掌握度可视化

\- 闪卡复习正确率

4\. 对话摘要压缩（中优先级）

当前 token-budget.ts 的 windowMessages 只是 丢弃 超出预算的旧消息。参考文档中 Sophia 的做法是将旧对话 压缩成摘要 注入 prompt，避免上下文断裂。当前实现下，长对话会突然丢失早期上下文。

5\. 教学教练分析（低优先级，但是"下一个该加的功能"）

参考文档 teaching-coach.md 明确说"MVP 可以不做，但它是提升对话质量的第一个值得加的特性"。每 N 轮由独立 LLM 调用分析师生对话质量，产出结构化教学状态评估，注入后续 prompt。

6\. TTS 语音朗读（低优先级）

README 提到"可先用浏览器 TTS 或暂不实现"。当前完全未实现。可用 Electron 的 speechSynthesis Web API 或系统 TTS。

7\. 对话进度回写教材

下课时生成的 progress artifact 存在 artifact store 里，但 没有回写到 textbooks/{id}/progress.md。教材的阅读进度没有跨课堂持久化。

8\. 离线/连接状态指示

无网络或 API 不可达时，用户无提前感知，只能发消息后看到错误。

三、架构/设计改进建议

1\. ADR 文档与实现脱节

\- ADR-001（DeepSeek-only）已被违反——provider-store.ts 实现了多 provider（deepseek/mimo/custom），但没有写新 ADR 记录这个决策变更

\- ADR-004（不做云同步）已被违反——WebDAV 同步完整实现，但无 superseding ADR

\- 实施计划中所有 checkbox 仍为 - \[ ] 未勾选，但实际全部完成

2\. 流式回复中断后内容丢失

ClassroomView.tsx:249-256 — 流式出错时，catch 块设置 retryMessage 但 不保存已收到的部分内容。如果网络中断在 80% 时，那 80% 的内容就丢了。应将部分内容也持久化。

3\. 无自动重试

errors.ts 已定义 retryable: true（429/500/503），但流式发送和 artifact 生成都没有自动重试逻辑。对 transient error 应支持 1-2 次指数退避重试。

4\. 多标签页状态不持久

ClassroomView.tsx 的 tab 系统在应用重启后丢失所有未关联 conversation 的标签页。

5\. 窗口消息去重

token-budget.ts:124 — windowMessages 保留了 history 中的 system 消息，但 buildMessages 在 prompt-builder.ts:212 又单独添加了 system 消息。如果 history 包含 system 消息会重复。虽然 chat-prompt.ts:89 已过滤掉 system role，但这是一个脆弱的隐式约束。

四、优先级排序建议

优先级	项目	类型

P0	目录删除 Bug (unlink → rm)	Bug

P0	Handoff Tail 注入到下节课 prompt	缺失功能

P1	IPC 输入校验统一用 Zod	安全/质量

P1	消息存储改 JSONL 追加写入	性能

P1	流式中断时保存部分内容	Bug

P1	Artifact 生成失败反馈给用户	UX

P2	闪卡复习 UI	缺失功能

P2	对话摘要压缩替代纯丢弃	功能增强

P2	教材进度回写	缺失功能

P2	CSP 策略	安全

P3	学习统计仪表盘	新功能

P3	教学教练分析	新功能

P3	搜索索引优化	性能

P3	ADR 文档更新	文档

[✓] P0: Fix unlink(dir) bug in conversation-store.ts and textbook-store.ts
[✓] P0: Inject handoff tail from previous session into next class prompt
[✓] P1: Preserve original filenames on WebDAV server instead of source.* (reference anxreader)
[✓] P1: Unify IPC input validation with Zod schemas
[✓] P1: Change message storage from JSON array to JSONL append
[✓] P1: Save partial content on stream interruption
[✓] P1: Report artifact generation failures to user
[•] P2: Add flashcard review UI
[ ] P2: Conversation summary compression instead of pure windowing
[ ] P2: Writeback textbook progress from lesson artifacts
[✓] P2: Add Content Security Policy to Electron window
[✓] P2: Add automatic retry for transient LLM errors (429/500/503)
[ ] P3: Learning statistics dashboard
[ ] P3: Update ADR documents to reflect multi-provider and WebDAV sync decisions
[ ] Final: Run typecheck + tests + security verification
