# Sophia-Local 优化计划 v4

> 基于原版官方更新历史（https://www.sophia.app/zh/changelog，v1.0.1 → v4.5.0）逐版本梳理。
> 只选取对学习本身有用的能力；宠物养成/孵化、社区论坛、云应用与跨设备、书店与兴趣推荐、
> 语音服务选型、课堂背景、能量条、主题外观、推广返利等产品化/花哨内容一律排除。
> 进度标记：[ ] 待办  [~] 进行中  [x] 已完成

---

## A. 教学效果（核心）

### A1. 跨章节教材检索 + 课堂引文
- **现状**：教材内容全量截断注入 system prompt（`chat-prompt.ts` → `truncateToBudget`），
  没有"当前读到哪"的位置感知，AI 只能看到书的前 2000 token；聊天中没有教材出处引用。
- **参考**：4.0.0「Companions can now find related material across the whole book」——
  概念跨章节时自动检索全书相关段落带入当前课堂；3.0.0 / 4.1.0「textbook-citation buttons
  woven into the chat bubbles」——气泡内可点击查看教材原文对照。
- **实现思路**：
  1. [x] 新增 `prompt/textbook-retrieval.ts`：按标题切分教材 → 从近期消息提取关键词
     （CJK 二元组/三元组 + 英文词，停用词/IDF 过滤）→ 检索相关章节段落。确定性实现，无额外 LLM 调用。
  2. [x] `chat-prompt.ts` 注入「教材相关段落（跨章节检索）」段，带章节标题；
     prompt 规则要求引用教材时用引用块 + 标注出处，禁止编造。
  3. [ ] 引文按钮 v2：AI 输出结构化引文标记（`【教材出处 · 第X章 章节名】`），
     渲染为可展开的「查看教材原文」并高亮匹配句（需新增 `textbook:search-excerpt` IPC）。
- **涉及文件**：新增 `prompt/textbook-retrieval.ts`、`chat-prompt.ts`、`prompt-builder.ts`、`ChatMessage.tsx`、`data.ts`
- **状态**: [~]

### A2. 费曼回讲模式（去宠物化的「知识蛋」）
- **现状**：只有「导师提问、学习者回答」的单向苏格拉底模式；下课产物无「学习者复述内容」。
- **参考**：3.0.0 Pet Mode 的学习内核——学习者向一个充满好奇的学徒复述所学，学徒追问、
  点破「其实你还没懂」；下课把回讲提炼成可编辑的知识蛋。宠物养成部分是花哨壳，剥离。
- **实现思路**：
  1. [x] `chat:get-prompt-messages` / `conversation:end` 支持 `classMode: 'standard' | 'feynman'`
  2. [x] `prompt-builder` 新增「费曼回讲模式」段：伙伴切换为好奇学徒，请学习者讲解，
     每次只追问一个漏洞点，先引导自我发现、必要时给最小提示
  3. [x] `ClassroomView` 每个标签页带模式开关（标准课堂 / 费曼回讲），随消息与下课请求传递
  4. [x] 新增 `feynman_note` artifact（知识蛋）：总结学习者讲对了什么、暴露的误区、
     下次追问方向；存入 artifact store 可在历史中查看
- **涉及文件**：`ids.ts`、`artifact.ts`、`ipc.ts`、`generate.ts`、`data.ts`、`chat-prompt.ts`、
  `prompt-builder.ts`、`preload/index.ts`、`ClassroomView.tsx`、`HistoryView.tsx`、`global.d.ts`
- **状态**: [x]

### A3. 先建立情境再提问 / 不假设已读书
- **现状**：`rules.ts` 无相关约束；AI 可能跳过必要语境直接抛出概念性问题。
- **参考**：4.4.0「Companions establish the situation before asking you to think」；
  4.5.0「Companions are less likely to assume that you have already read the textbook.
  Terms and author-defined categories that only a reader would know are introduced
  naturally before you are asked to reason about them」。
- **实现思路**：`rules.ts` 新增「情境先行」规则段：正式提问前先补齐必要的事实/定义/语境；
  首次出现的术语先在情境中自然引入；不假设学习者已读过教材。
- **涉及文件**：`rules.ts`、`prompt-builder.ts`
- **状态**: [x]

### A4. 单消息单问题 + 不制造虚假二选一
- **现状**：旁白规则只要求「以一个提问结尾」。
- **参考**：4.5.0「Each message asks one question that genuinely moves understanding forward.
  When several answers can coexist, the companion no longer forces a false either-or choice」。
- **实现思路**：增强旁白/提问规则：一条消息只问一个真问题；答案可共存时不做非此即彼。
- **涉及文件**：`rules.ts`
- **状态**: [x]

### A5. 三档教学节奏（慢 / 标准 / 快）
- **现状**：无节奏控制。
- **参考**：3.0.0「A teaching pace you can dial — slow, normal, or fast」；4.1.0
  「Both Standard Pace and Take It Slow cover material more thoroughly. Mastering one point
  no longer causes nearby independent ideas to be skipped」。
- **实现思路**：课堂内节奏开关（或设置页），注入 prompt：慢速 = 不跳过独立知识点、
  重视关键例子/边界/不同题型；快速 = 学习者已掌握处可略过。
- **涉及文件**：`rules.ts`、`prompt-builder.ts`、`chat-prompt.ts`、`ClassroomView.tsx`、`SettingsView.tsx`
- **状态**: [ ]

### A6. 尊重教材节奏（只提及不展开）
- **现状**：AI 可能把教材只提一句的概念（如章节开头的预告）展开成教学块。
- **参考**：1.0.6「The teacher no longer over-expands content the textbook only mentions
  in passing」——明说「教材这里只是提及」，让学习者选择：简单概述 / 跳到真正展开的章节 / 继续当前节奏。
- **实现思路**：并入 A3 的规则段。
- **涉及文件**：`rules.ts`
- **状态**: [x]

---

## B. 复习与输出

### B1. 闪卡可修正
- **现状**：`FlashcardReviewView` 的卡片只读，无法改正答案/解释。
- **参考**：4.0.1「You can correct a flashcard yourself — choose Correct beside Explanation
  on the back of a card to change the right answer or revise the explanation」。
- **实现思路**：卡片背面加「修正」按钮，编辑后持久化（更新对应 artifact 内容）。
- **涉及文件**：`FlashcardReviewView.tsx`、`data.ts`（artifact 更新）
- **状态**: [x]

### B2. 闪卡导出 Anki
- **现状**：无 Anki 导出。
- **参考**：1.0.2 / 4.5.0「Flashcards can be exported to Anki … tagged by textbook + month」。
- **实现思路**：解析 flashcards artifact → 生成 Anki 文本导入文件（`#separator:tab` 格式），
  按教材 + 月份打标签；复习页/历史页加导出按钮。
- **涉及文件**：`FlashcardReviewView.tsx`、`HistoryView.tsx`、`data.ts`
- **状态**: [x]

### B3. 课后自测题（提示逐级揭晓）
- **现状**：`lesson_summary` 没有自测题。
- **参考**：1.0.7「Post-class notes … staged hint→answer reveal for self-test questions」。
- **实现思路**：课堂总结生成 prompt 增加 2–3 道自测题，每题带「提示1 → 提示2 → 答案」。
- **涉及文件**：`generate.ts`
- **状态**: [x]

### B4. 课后产物可重跑（只补缺失项）
- **现状**：`generateArtifacts` 失败项只写 log，无重试入口。
- **参考**：4.0.0「Post-class updates can be run again … redo only the missing work」。
- **实现思路**：`conversation:end` 返回 failures；下课结果卡片/历史页提供
  「补齐缺失产物」按钮，只对缺失类型重新生成。
- **涉及文件**：`data.ts`、`ClassroomView.tsx`、`HistoryView.tsx`、`generate.ts`
- **状态**: [x]

### B5. 对话回退（rewind，可选）
- **现状**：有编辑/删除/重生成，无「从某条消息分支重启」。
- **参考**：3.0.0「Rewind the class conversation to an earlier point and continue from there」。
- **实现思路**：选中消息 →「从这里重新开始」：删除其后的消息并从该点继续。
- **涉及文件**：`ClassroomView.tsx`、`data.ts`
- **状态**: [ ]

---

## C. 日常学习体验

### C1. 纯净对话模式（隐藏旁白）
- **现状**：`rules.ts` 强制每条消息带 `*动作/表情旁白*`，无开关；TTS 已剥除 `*…*`。
- **参考**：3.0.0「hide expression/action descriptions」；4.5.0 旁白不再被 TTS 读成正文。
- **实现思路**：设置开关「隐藏动作/表情旁白」→ 注入 prompt 指示不用旁白；渲染端照常。
- **涉及文件**：`rules.ts`、`prompt-builder.ts`、`SettingsView.tsx`
- **状态**: [x]

### C2. 用户消息支持 Markdown / 公式渲染
- **现状**：`ChatMessage.tsx` 用户消息是纯文本 `<p>`。
- **参考**：1.0.7「User messages now support markdown / formula rendering」。
- **实现思路**：用户消息改用 ReactMarkdown（同一渲染管道，不启用代码执行）。
- **涉及文件**：`ChatMessage.tsx`
- **状态**: [x]

### C3. 学习统计增强（时长 / 连续天数 / 年度热力图）
- **现状**：`StatsView` 按会话创建日计数，无学习时长、连续天数、年度热力图；
  跨天会话的时间会算错天。
- **参考**：1.0.9「cumulative study time · completed lessons · daily streak · GitHub-style heatmap」；
  2.1.1「time now bucketed per actual day」。
- **实现思路**：用消息时间戳估算每日学习时长（会话内相邻消息间隔 > 45 分钟则截断为新段），
  按实际日期分桶；增加连续天数与年度热力图。
- **涉及文件**：`StatsView.tsx`
- **状态**: [x]

### C4. 公式 / 符号快速插入面板
- **现状**：课堂输入是纯文本，无数学符号入口。
- **参考**：1.0.7「math symbol / formula quick-insert panel」；3.1.0 公式编辑器。
- **实现思路**：输入区加 Σ 按钮 → 弹出面板（希腊字母 / 运算 / 集合逻辑 / 公式模板），
  点击插入到输入框光标处。
- **涉及文件**：`ClassroomView.tsx`
- **状态**: [x]

### C5. 快捷键小抄 + 输入保护
- **现状**：已有 Ctrl+T/W/Tab/F 等，但无说明入口；Ctrl+F 在输入框打字时也会触发。
- **参考**：3.2.0「Press ⌘/Ctrl+/ for a cheat sheet … shortcuts never fire while you're typing」。
- **实现思路**：Ctrl+/ 弹出快捷键说明；快捷键 handler 忽略输入框/文本域聚焦场景。
- **涉及文件**：`ClassroomView.tsx`、`App.tsx`
- **状态**: [x]

---

## 建议实施顺序

| 批次 | 项目 | 理由 |
|------|------|------|
| 第 1 批 | A1（检索+注入）+ A2 | 全书关联教学 + 费曼回讲 — 拉开学习效果差距 |
| 第 2 批 | A3 + A4 + A6 | 纯 prompt 规则 — 改动小、见效快（已完成） |
| 第 3 批 | C1 + C2 | 纯净对话 + 用户消息渲染 — 阅读专注度（已完成） |
| 第 4 批 | B1 + B2 | 闪卡修正 + Anki 导出 — 复习闭环（已完成） |
| 第 5 批 | B3 + B4 | 自测题 + 产物重跑 — 课后巩固（已完成） |
| 第 6 批 | C3 + C4 + C5 | 统计 / 公式面板 / 快捷键 — 体验打磨（已完成） |
| 第 7 批 | A1 引文按钮 v2 + B5 | 结构化引文 + 对话回退 — 成本较高，最后做 |
