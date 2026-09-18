# AGENTS.md

本文件面向在此仓库工作的 AI Agent 与贡献者，只记录**能省时间、避免踩坑**的约定。

## 验证门禁（提交前必跑）

```bash
npm test            # typecheck + lint + 单测 + 安全基线（唯一必跑命令）
npm run test:coverage  # 覆盖率及门槛（CI 用这个）
```

- `npm test` = `typecheck && lint && test:unit && test:security`（见 package.json）。
- **lint 必须 0 错误且 0 警告**（`--max-warnings 0` 语义已按此执行）。
- 打包相关：`npm run build:win`（会附带 `test:fuses`）；`npm run build:dir` 只出 `release/win-unpacked`，`npm run smoke` 启动它（独立 `--user-data-dir`，校验存活 12s + LocalData 布局落盘）。CI 跑 `build:dir` + `smoke` 拦截「能打包但启动即崩」。
- 发布走 `release.yml`（附带 `latest.yml`，`--publish never`）；依赖更新由 `.github/dependabot.yml` 每周开 PR（minor/patch 聚合、major 单独）。

## 数据版本与迁移（LocalData）

- `src/main/storage/data-version.ts` 是数据布局的版本闸门：`initDataDir` 启动时调 `migrateDataRoot`，把 `LocalData/data-version.json` 升到 `DATA_VERSION`。
- **改数据布局（重命名/废弃文件、改 JSON 形状）时必须**：`DATA_VERSION + 1`，并在 `MIGRATIONS` 加 `n: async (root) => { ... }`（n→n+1，幂等）；无结构变化只加空步即可。
- 新版本数据被旧版本 App 打开时只警告、不落盘覆盖；`data-version.json` 是每设备标记，已在 `file-walker.ts` 中排除同步。

## 覆盖率门槛（只升不降）

- 门槛在 `vitest.config.ts` 的 `coverage.thresholds`；当前 **100/100/100/100**（语句/分支/函数/行）。
- 覆盖率只能上调；**禁止为通过构建而下调**。
- 死代码、纯防御分支（UI 已屏蔽、穷尽性 `never` 检查、无法在测试中可移植触发的故障捕获）用注释忽略：

  ```ts
  /* v8 ignore next -- @preserve */
  ```

  - `-- @preserve` **必须有**：esbuild 会剥掉普通注释，缺少后缀时忽略不生效。
  - JSX 属性中的箭头函数体无法落到注释上：把箭头改成块（`onClick={() => { /* v8 ignore next -- @preserve */ setX() }}`），或更优先写成真实测试。
  - 能测的真实分支**优先写测试**，不要用忽略掩盖。

## 测试文件约定（踩过的坑）

- **路径层级**：`tests/main/*.test.ts` 引用源码用 `../../src/...`；`tests/main/<子目录>/*.test.ts` 用 `../../../src/...`。层级写错会在仓库根误建 `LocalData/`、`Sophia-backups/` 等目录。
- **渲染器测试必须是 `.tsx`**：`tsconfig.web.json` 只纳入 `tests/renderer/**/*.test.tsx`；写成 `.ts` 会落到 node 项目里对渲染器源码报一堆 typecheck 错误。
- **jsdom 需要的手工 stub**：`ResizeObserver`、`window.matchMedia`、`Range.prototype.getBoundingClientRect`、`Element.prototype.scrollIntoView`、`offsetHeight/offsetWidth`、`clientWidth`。
- **虚拟列表**（Classroom/History）依赖 `offsetHeight` 与 ResizeObserver stub，参考 `tests/renderer/App.test.tsx` / `ClassroomView.test.tsx` 的写法。
- **TTS**：`useTTS` 在模块加载时采样 `speechSynthesis` 支持性 → 必须在 import 前用 `vi.hoisted`/`vi.stubGlobal` 安装 stub（见 `tests/renderer/hooks/useTTS.test.tsx`）。
- **模块级缓存**（如 `useTodayStudyMinutes`、`useFlashcards`）：测试之间用 `vi.resetModules()` + 动态 `import()` 隔离，不要指望 TTL 自然过期。
- **假定时器 + `vi.waitFor`**：用 `vi.useFakeTimers({ shouldAdvanceTime: true })`，否则 waitFor 无法推进。
- **重渲染/等待**：统一用 `await screen.findBy...` / `await vi.waitFor(...)`，禁止裸 `setTimeout` 断言（覆盖度运行会让慢机器误报，参考已修复的 app-bootstrap 落盘时序）。
- **waitFor 的超时是等待预算，不是用例预算**：`vi.waitFor(..., { timeout: 10_000 })` 不会放宽默认 5s 的用例超时；等待后台任务（产物流水线/概念抽取/落盘）的用例必须同时声明用例超时，如 `it('...', { timeout: 30_000 }, async () => ...)`，否则慢机下先撞用例超时而误报。

## 数据与安全

- 密钥类文件（`*.key.enc`、`profile-lock.enc`、`webdav-password.enc`）只能经 `SecureKeyStore` 落盘，走 safeStorage；**永不写明文、永不经 IPC 回传渲染层**。
- 测试数据根目录一律 `mkdtemp`，不要写进仓库；`reference/角色设定/candidates/` 只保留 3 个原创角色（landau / zu_chongzhi / emily）。
