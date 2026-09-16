# Changelog

本文件记录 Sophia 的重要变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [0.1.1] - 2026-09-16

### 修复

- **打包版自动更新从未生效**：`setupAutoUpdate()` 误置于 `app.on('activate')` 回调内，启动路径
  不会执行（Windows 下 activate 不触发）——后台检查与「退出时安装」现已恢复。

### 新增

- **设置页「关于」**：显示应用版本 + 手动检查更新（可用 / 已是最新 / 开发模式 / 失败四态反馈）；
  主进程新增 `updater:check-for-updates` 通道与共享 `UpdaterCheckResult` 类型。

### 变更

- **重构**：课堂消息列表与滚动系统抽为 `MessageList` + `useMessageListScroll`（贴底锚点/虚拟化/
  Ctrl+F 匹配导航）；Reader 进度持久化抽为 `reading-progress`、Ctrl+F 搜索壳抽为
  `ReaderSearchPopover`；EPUB 搜索高亮改受控渲染（`<mark>` 在 HTML 管线生成，去掉渲染后 DOM 突变）。
- **性能**：流式订阅下沉——聊天流控制器提升为应用级单例（切换视图不断流），外壳不再按 token
  重渲染，仅课堂按帧合并订阅。
- **工程化**：CI actions 升级（checkout/setup-node/upload-artifact v7、action-gh-release v3，
  消除 Node 20 弃用告警）；覆盖率门槛 35/27/29/36 → 44/36/41/45；新增 StatsView/ReviewView/
  阅读器/滚动/流订阅等测试（共 892 例全绿）。

## [0.1.0] - 2026-09-16

### 修复

- **P0 缺陷批次**：产物枚举缺 `lesson_*` 导致音频/时间线/FAQ 读取失效（复习页空）；ID 路径穿越防御
  （Zod `EntityIdSchema` + `app-data` 路径校验 + 归档 manifest 校验）；HTTPS 大小写绕过与 providers
  补 Zod；流式 `abort` 监听器泄漏与 `iterator` 未归还；重新生成/重试重复消息；
  每轮 prompt 重复注入当前用户消息；`safeSend` 防退出崩溃与产物流水线毒化；下课幂等；
  PDF 文档/渲染任务泄漏。
- **安全与可靠性**：`extract-zip` 高危漏洞（无修复版本）替换为自研安全解包（拒绝 symlink/路径穿越/超限），
  生产依赖 0 漏洞；主进程全局异常兜底与渲染崩溃自动重载；写入边界校验补全（消息 trim、
  SRS 状态形状与上限、备份恢复与概念查询补 Zod）；同步回收站 MOVE 逐级建目录（嵌套文件不再降级为永久删除）；
  `atomicWriteFile` 增加 fsync 与 Windows rename 重试。
- **LLM 健壮性**：SSE 坏行跳过不中断整条流 + 90 秒空闲超时断连；`DeepSeekClient` 支持取消
  （退避可中断），思考模型被截断时给出明确提示。
- **缓存与一致性**：prompt 缓存有界（50 条 LRU）+ 压缩摘要内容指纹 + 会话删除/回退/编辑时清理；
  候选角色编辑跨重启保留 + 删除墓碑防复活（归档恢复自动清除）。
- **渲染层**：课堂标签草稿持久化防抖 + 卸载强制落盘；全局快捷键监听只注册一次；修复 HistoryView
  自动选中课堂但详情不加载的缺陷；历史详情消息列表虚拟化（长课堂只渲染可见窗口）；EPUB 搜索按章缓存
  并修复翻章被弹回；修复测验卡片按钮文案缺陷。

### 变更

- **性能**：流式 token 按帧合并渲染；今日学习时长/统计/到期卡片计数下沉主进程聚合（渲染层不再全量
  拉取消息与产物）；消息组件 memo 化与事件卡解析移入 `useMemo`；复习卡片与教材查询并行化。
- **工程化**：CI（typecheck / lint / 单测 / 安全基线 / 构建）；Release workflow
  （手动构建安装包 artifact，`v*` tag 自动创建 GitHub Release，含 fuses 校验与签名占位）；
  **自动更新**（electron-updater：打包版后台检查/下载，退出时安装，设置页可手动检查，失败仅记日志）；
  覆盖率全量口径并设防回退门槛；
  打包瘦身（安装包 153.9 → 101.4 MB，`app.asar` 219 → 40.8 MB）；Electron 安全 fuses 与打包校验；
  `verify-security` 覆盖全部渲染层文件；ESLint 类型感知规则与 0 告警；新增 API 类型契约
  （编译期校验 preload 与 renderer 声明一致）；组件测试基础设施（jsdom）与核心流程回归测试。
- **无障碍**：对话框语义/键盘关闭/焦点管理、标签页 `tablist` 语义与键盘切换、图标按钮
  `aria-label`、消息区 `role="log"`。
- 项目以 **MIT** 协议开源（新增 `LICENSE` 与 `package.json` 的 `license` 字段）。
- 卸载不再删除用户学习数据（`deleteAppDataOnUninstall: false`）。

### 里程碑 1-5（2026-07）

- 里程碑 1：概念掌握度系统（对话中增量识别、EMA 掌握度、误解点、证据溯源、复盘页概念 tab）。
- 里程碑 2：事件卡片（提示/纠错/记忆提议）+ 引用真实性规则校验 + 人格版本管理；
  课堂快捷操作与测验卡片化。
- 里程碑 3：教学闭环（概念掌握度注入课堂 prompt，薄弱优先复习、教材隔离；复盘页下一步建议）。
- 里程碑 4：多形态产物（课后音频回顾/课堂时间线/课堂 FAQ）。
- 里程碑 5：AI 质量测试（固定教材与问题集，引用真实性防伪造、苏格拉底式、不越界）。
- 基础能力：教材导入（PDF/EPUB/Markdown）、课堂流式对话、SRS 复习、学习统计、
  本地备份与 WebDAV 同步、主题系统。
