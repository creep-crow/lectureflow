# LectureFlow · 全英课堂听讲助手

通过系统麦克风实时转写英文课堂，先显示中文初译，再结合前文拼接、断句和润色；使用 ChatGPT 通过 MCP 读取课堂并保存总结分析。

公开版本默认在自己的电脑运行，网站与本地 MCP 共用本机 SQLite 数据库。不需要 Sites / Cloudflare 账号、Git 或预装 Node.js；首次运行自动补齐依赖。原作者的 Sites 自用版本单独维护。

**Windows：下载并解压源码，双击 `start.cmd`。macOS / Linux：运行 `bash start.sh`。** 首次启动后在网页填写自己的 Gemini 和翻译密钥。详细步骤见[本地一键运行](docs/LOCAL.md)。

## 功能

| 模块 | 功能 |
| --- | --- |
| 实时转写 | Google AI Studio / Gemini Live，麦克风选择、继续听讲和断线重连；提供备用分段模式 |
| 中文翻译 | DeepSeek / OpenAI 兼容接口，自定义网址、API Key、获取模型列表和手填模型 |
| 译文整理 | 原文到达立即初译；读取附近已完成的双语内容，随后拼接、重新断句和润色 |
| 请求设置 | 流式与思考开关，最多 16 枚翻译密钥、1–6 个并发，轮换、冷却和失败切换 |
| 连接保存 | 当前浏览器自动保存设置；多密钥支持换行、逗号、中文逗号和分号 |
| 课堂记录 | 搜索、完整回看、重命名、Markdown 导出、回收站及恢复 |
| 学习笔记 | 个人笔记与 AI 分析分开保存，版本校验防止旧窗口覆盖较新笔记 |
| ChatGPT + MCP | 读取课堂与笔记，追加保存课堂总结；无需 OpenAI API Key |
| 本地一键启动 | 自动补齐 Node.js / npm / 依赖、构建和迁移；重复启动复用已有服务 |
| 本地 stdio MCP | 桌面客户端执行 `mcp.cmd` 即可，自动连接与网页共享的数据库 |

Gemini 负责转写，所选翻译模型负责中文翻译，ChatGPT 仅负责总结分析。总结由用户在聊天中发起，并非自动后台生成。

## 免费层级 Gemini API Key：简短教程

默认使用 `gemini-3.5-transcribe-live` 连续转写，减少分段请求次数。该模型提供免费层级，参见 [Google 官方定价](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-transcribe-live)；实际额度以自己的 [AI Studio 项目额度](https://aistudio.google.com/rate-limit)为准，不能保证无限使用，参见 [Google 额度说明](https://ai.google.dev/gemini-api/docs/rate-limits)。

1. 打开 [Google AI Studio](https://aistudio.google.com/)，使用 Google 账号登录，按页面提示完成首次使用设置。
2. 进入 [API Keys 页面](https://aistudio.google.com/api-keys)。新用户可能已有默认项目和密钥；也可点击 **Create API key**，选择或创建自己的项目。已有 Cloud 项目需先在 Projects 导入。
3. 在项目/密钥列表确认 **Billing Tier 为 Free Tier**。如只想使用免费层级，不进行 **Set up billing / Upgrade**，也不要选择已经关联付费账单的项目。
4. 复制密钥，在 LectureFlow 的“连接设置 → Gemini API Key”中粘贴，点击“保存并应用”；本地开发也可填入 `.env` 的 `GEMINI_API_KEY`。不要将密钥写进仓库。

创建方式参考 [Google 官方密钥教程](https://ai.google.dev/gemini-api/docs/api-key)及[免费层级说明](https://ai.google.dev/gemini-api/docs/billing/)，于 2026-10-06 核对。

## 快速开始

普通用户无需手动执行安装或迁移命令：

```sh
# Windows：双击 start.cmd，或在终端运行
start.cmd
# macOS / Linux
bash start.sh
```

脚本自动安装 Node.js 22.13+ / npm 所需环境，复制不存在的 `.env` 模板，并初始化数据库。已有密钥和课堂不会被覆盖。首次运行需要联网；网页填写 Gemini / DeepSeek 或 OpenAI 兼容接口的连接参数即可。免费 Gemini 层级不包含翻译服务费用。

只安装和准备、暂不启动网页：

```sh
start.cmd --prepare-only
# macOS / Linux：bash start.sh --prepare-only
```

默认打开 `http://127.0.0.1:5173/`，直接进入本地课堂，无需登录 ChatGPT。启动窗口负责后台，按 Ctrl+C 可停止；下次再双击即可继续使用。开发者仍可自行使用 Node.js 22.13+ / npm 运行 `npm ci` 与开发命令。

## 文档

- [使用说明](docs/USER_GUIDE.md)：听讲、连接设置、课堂记录和失败恢复。
- [本地一键运行](docs/LOCAL.md)：安装、修复、升级、备份和常见问题。
- [部署说明](docs/DEPLOYMENT.md)：独立本地运行与可选远程托管边界。
- [MCP 接口与 ChatGPT 接入](docs/MCP.md)：工具参数、分页、鉴权和总结请求。
- [架构说明](docs/ARCHITECTURE.md)：数据流、两阶段翻译与关键代码。
- [发布说明](CHANGELOG.md)与[第三方许可说明](THIRD_PARTY_NOTICES.md)。

## 开发验证

```sh
npm run typecheck
npm run lint
npm test
npm run build
node scripts/verify-release.mjs
```

本地后台启动后，可运行 `npm run test:integration`。测试包含语音、翻译、保存队列、本地运行与 MCP 协议检查。真实 Gemini Live 和 DeepSeek 调用曾验证通过；真实接口脚本会使用自己的密钥和额度，不属于普通测试。

## 部署与 MCP

本地网页与 MCP 使用同一后台和数据库。支持 stdio 的桌面客户端可执行 `mcp.cmd`；网页内可复制当前电脑的配置。后台未运行时 MCP 入口会自动启动，已运行时复用。详见 [MCP 接入说明](docs/MCP.md)。

ChatGPT 网页版不能直接执行本地 stdio 脚本。可导出课堂用于分析；远程 MCP 需独立配置 HTTPS、认证和远程存储。公开版本不会自动注册或发布 Sites。GitHub Pages 不能运行后端。

## 数据与限制

不持久保存原始录音；原文、译文、笔记和分析保存在 `.wrangler/state` 的本地 SQLite。自填密钥以明文存储于当前浏览器 localStorage，可在连接设置中清除，不写入课堂记录。翻译请求会发送当前原文与有限双语上下文至所选服务。

二次润色会增加调用。多密钥并发仅在当前页面协调，不能绕过共享账户额度。同步失败保留页面内容，但不能保证崩溃时恢复未保存文本；请重试同步或导出课堂备份。

本仓库仅发布程序与模板，不包含课堂数据、真实凭据、个人部署配置及原开发仓库历史。公开源码不改变已有网站的私密访问设置。
