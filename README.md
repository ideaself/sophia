# Sophia

本地优先的 AI 苏格拉底式启发学习伙伴（Electron + React + Tailwind）。

角色化 AI 通过提问引导学习者自己发现知识：教材阅读与批注、课堂对话、课后自动生成
学习摘要/记忆卡片/学习日记，支持 SRS 复习、学习统计与本地备份。完全本地运行，
用户自带 DeepSeek API Key，数据全部保存在本地文件系统。

## 功能

- 课堂：角色选择、教材上下文、流式回复、Markdown / KaTeX / Mermaid、AI 代答、多标签
- 教材：PDF / EPUB / Markdown 导入，阅读进度与高亮批注，跨章节检索
- 课后产物：课堂总结、记忆卡片、学习日记、学习进展、知识点图谱、费曼知识蛋
- 复习：SRS 间隔复习、珍藏卡、Anki 导出、键盘连答
- 统计：本周报告、14 天时长、年度热力图、角色/教材分布
- 数据：本地文件存储、WebDAV 同步、自动备份与恢复、配置导出/导入
- 主题：暗夜 / 护眼 / 暖光 / 跟随系统

## 开发

```bash
npm install
npm run dev           # 开发模式
npm run typecheck     # 类型检查（node + web 两份 tsconfig）
npm run lint          # ESLint
npm run test          # typecheck + lint + 单测 + 安全基线
npm run test:coverage # 单测 + 覆盖率报告（含保守门槛，防止覆盖率回退）
npm run build         # 构建（electron-vite）
npm run build:win     # 打包 Windows 安装包（NSIS）
npm run clean         # 清理 out/ release/ coverage/
```

Node >= 22.13（见 `engines`；pdfjs-dist / unpdf 的硬性要求）。

## 架构

```
src/
  main/        主进程：窗口/托盘/生命周期、IPC、LLM（流式适配）、存储、WebDAV 同步、备份、学习记忆
  preload/     contextBridge 桥：只暴露 window.sophia（类型化 invoke/订阅）
  renderer/    React 渲染层：课堂、阅读器、复习、统计、设置（Vite 打包，依赖进 bundle）
  shared/      两侧共享：Zod schema、IPC 契约、纯逻辑工具（tab 持久化、SRS、事件卡等）
tests/         Vitest：main / shared 纯逻辑 + renderer jsdom 组件测试（`.tsx`）
scripts/       verify-security.mjs（安全基线）、clean.mjs
```

- 主进程按领域注册 IPC（`src/main/ipc/*.ts`），所有入参在 IPC 边界用 Zod 校验；
  领域 ID 统一 `EntityIdSchema`（`^[A-Za-z0-9_-]{1,128}$`），路径拼接在 app-data 层二次校验。
- LLM 调用只发生在主进程：API Key 解密后直接传给适配器，永不进入渲染层。
- 产物流水线（下课生成总结/卡片/日记等）在后台串行队列执行，完成后通过 IPC 事件通知 UI。

## 数据布局（LocalData）

```
{dataRoot}/
  config/           providers.json + *.key.enc（加密的 API Key / WebDAV 密码）
  companions/       角色（index.json + 候选角色 .md）
  textbooks/        教材（textbook.json / source.md / 原件 / notes/）
  conversations/    课堂（conversation.json + messages.json + artifacts/）
  diary/            学习日记（按月 .md）
  concepts.json     概念掌握度（EMA + 误解点 + 证据溯源）
  learner.md / pal_moments_*.md / relation_*.md / handoff_meta.json
```

`config/*.enc`、`sync-state.json`、`.trash/`、`*.conflict-*` 永不参与 WebDAV 同步。

## 安全模型

- 渲染进程 `contextIsolation + sandbox + nodeIntegration: false`，只通过 preload 的
  `window.sophia` 通信；API Key 仅有 `has/set/delete`，无读取接口。
- 出站模型请求强制 HTTPS（`assertHttpsEndpoint`，`new URL` 解析防大小写绕过）。
- 外部链接仅允许 http(s)（IPC 与 `setWindowOpenHandler` 同一策略）。
- WebDAV 密码与 API Key 经 Electron `safeStorage` 加密后落盘。
- 打包产物启用 Electron 安全 fuses（禁 RunAsNode / NODE_OPTIONS / 调试参数、
  强制 Cookie 加密、仅从 asar 加载）；`npm run build:win` 会自动执行
  `npm run test:fuses` 校验。
- `npm run test:security` 验证上述基线（preload 暴露面、窗口配置、IPC 校验）。

## 测试与覆盖率

- `npm run test`：typecheck + lint + 单测 + 安全基线，CI（`.github/workflows/ci.yml`）同款。
- 覆盖率按"全部源码"口径统计（`include` 覆盖 src 全部文件），不是只统计被测试加载过的文件。
  当前 **100% 语句 / 89% 分支 / 99% 函数 / 100% 行**（门槛 100/89/99/100，只升不降；
  CI 直接跑 `test:coverage`，门槛在 CI 强制执行）。
- 不可达/纯防御分支用 `/* v8 ignore next -- @preserve */` 标注（`@preserve` 必需，
  否则 esbuild 会剥掉注释）；约定详见 [AGENTS.md](./AGENTS.md)。
- 类型契约：`src/renderer/src/types/api-contract.ts` 在编译期校验 renderer 声明与
  preload 实现的双向一致性（`skipLibCheck` 不会掩盖两边的漂移）。
- 变更历史见 [CHANGELOG.md](./CHANGELOG.md)；环境变量模板见 [.env.example](./.env.example)。

## 发布

- **构建安装包**：本地 `npm run build:win`，或 GitHub Actions → Release workflow
  （手动触发即产出 artifact；推送 `v*` tag 会自动创建 GitHub Release）。
  产物为 `release/Sophia-<version>-Setup.exe`，构建流程内含 Electron fuses 校验。
- **安装**：下载 `Sophia-<version>-Setup.exe` 双击安装即可（当前用户级安装，无需管理员）。
  安装包未签名，首次运行 SmartScreen 会提示"Windows 已保护你的电脑"——点「更多信息」→
  「仍要运行」；也可在文件属性里勾选"解除锁定"。
- **平台**：当前仅 Windows x64。mac/arm64 需要对应签名与 CI 运行时，尚未配置。
- **代码签名未启用**：未签名安装会触发 SmartScreen 提示。配置仓库 Secrets
  `CSC_LINK`（证书 base64/路径）与 `CSC_KEY_PASSWORD` 后，release workflow 与本地
  构建会自动签名。
- **自动更新已启用**：打包版启动 30 秒后后台检查 GitHub Releases（`electron-updater`），
  自动下载并在**下次退出时安装**（静默安装后自动重启，不打断课堂）；设置页「关于」
  可手动检查更新并显示版本。检查失败仅记录日志。升级链路已实测（0.1.2 → 0.1.3，
  含退出时安装）。发版要求：Release 必须包含 workflow 产出的 `latest.yml`（自动附带），
  且**发布前先用安装包完整验证一次升级链路**——自动更新会把任何发布失误直接推送给所有用户。

## 技术栈

- 桌面壳：Electron（contextIsolation + sandbox）
- 前端：React + Tailwind CSS v4
- LLM：DeepSeek API（OpenAI-compatible，主进程调用，Key 安全存储）
- 渲染：react-markdown + KaTeX + rehype-highlight + Mermaid
- 输入校验：Zod（IPC 边界）
- 测试：Vitest（v8 覆盖率）

## 许可

[MIT](LICENSE)。内置预设角色（朗道、祖冲之、艾米莉·卡特）文案均为原创；基于历史人物的
角色仅使用公开生平与学术观点。第三方依赖均为 MIT/Apache 类宽松协议。
