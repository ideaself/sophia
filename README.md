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
npm run dev        # 开发模式
npm run typecheck  # 类型检查
npm run lint       # ESLint
npm run test       # 单测 + 安全基线
npm run build      # 构建
npm run build:win  # 打包 Windows 安装包
```

## 技术栈

- 桌面壳：Electron（contextIsolation + sandbox）
- 前端：React + Tailwind CSS v4
- LLM：DeepSeek API（OpenAI-compatible，主进程调用，Key 安全存储）
- 渲染：react-markdown + KaTeX + rehype-highlight + Mermaid
- 输入校验：Zod（IPC 边界）
