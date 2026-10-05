# LectureFlow · 全英课堂听讲助手
## 本项目是为了醋（google提供免费sota级转写模型）包的饺子（本项目），充满大量vibe coding和一拍脑袋的产物，总之能用。

通过系统麦克风实时转写英文课堂，先显示中文初译，再结合前文拼接、断句和润色；使用支持 MCP 的 AI 助手读取课堂并保存总结分析。


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
| Agent + MCP | Codex、Claude Desktop / Code、Cursor、VS Code / Copilot 和通用 Agent SDK 配置；读取课堂、笔记并保存分析 |
| 本地一键启动 | 自动补齐 Node.js / npm / 依赖、构建和迁移；重复启动复用已有服务 |
| 本地 stdio MCP | 自动连接与网页共享的数据库；可选只读连接，提供总结模板和结构化结果 |

Gemini 负责转写，所选翻译模型负责中文翻译，ChatGPT 或其他 Agent 仅负责总结分析。总结由用户在客户端发起，并非自动后台生成。LectureFlow MCP 不调用模型，也不要求 OpenAI API Key；所选客户端的登录和模型配置由该客户端负责。

## 免费层级 Gemini API Key：简短教程

默认使用 `gemini-3.5-transcribe-live`进行实时转写，该模型在ai studio中的免费层级可以无限额使用。
不推荐使用分段转写模式，其对应的gemini-3.5-transcribe提供给免费层级的用量较少，更适合转写整个音频文件。

1. 打开 [Google AI Studio](https://aistudio.google.com/)，使用 Google 账号登录，按页面提示完成首次使用设置。
2. 进入 [API Keys 页面](https://aistudio.google.com/api-keys)。新用户可能已有默认项目和密钥；也可点击 **Create API key**，选择或创建自己的项目。已有 Cloud 项目需先在 Projects 导入。
3. 在项目/密钥列表确认 **Billing Tier 为 Free Tier**。如只想使用免费层级，不进行 **Set up billing / Upgrade**，也不要选择已经关联付费账单的项目。
4. 复制密钥，在 LectureFlow 的“连接设置 → Gemini API Key”中粘贴，点击“保存并应用”；本地开发也可填入 `.env` 的 `GEMINI_API_KEY`。不要将密钥写进仓库。


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
- [多 Agent MCP 接入](docs/MCP.md)：各客户端配置、只读模式、工具参数、分页和总结模板。
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

本地后台启动后，可运行 `npm run test:integration` 和 `npm run test:mcp`。后者使用官方 MCP SDK 验证 stdio / Streamable HTTP、多个同时连接的客户端、只读限制、分页和总结写回，不调用外部模型。测试会创建并移入回收站测试课堂。真实 Gemini Live 和 DeepSeek 调用曾验证通过；真实接口脚本会使用自己的密钥和额度，不属于普通测试。

## 部署与 MCP

先启动本地网页，在“连接总结助手”选择自己的 Agent，复制对应的 JSON 或 TOML 配置。Windows 也可双击 `mcp-config.cmd` 导出全部配置；macOS / Linux 使用 `bash start.sh --export-mcp-configs`。生成的绝对路径与当前电脑匹配，只合并 `lectureflow` 条目，保留原有服务。

多个 Agent 同时使用时，请先通过 `start.cmd` / `bash start.sh` 启动并保留网页后台窗口。所有 MCP 连接复用它，退出一个客户端不影响其他客户端。单独连接 MCP 时可自动启动后台，但该客户端退出会结束它自行启动的后台。详见 [MCP 接入说明](docs/MCP.md)。

ChatGPT 网页版不能直接执行本地 stdio 脚本。可导出课堂用于分析；远程 MCP 需独立配置 HTTPS、认证和远程存储。公开版本不会自动注册或发布 Sites。GitHub Pages 不能运行后端。

## 数据与限制

不持久保存原始录音；原文、译文、笔记和分析保存在 `.wrangler/state` 的本地 SQLite。自填密钥以明文存储于当前浏览器 localStorage，可在连接设置中清除，不写入课堂记录。翻译请求会发送当前原文与有限双语上下文至所选服务。

二次润色会增加调用。多密钥并发仅在当前页面协调，不能绕过共享账户额度。同步失败保留页面内容，但不能保证崩溃时恢复未保存文本；请重试同步或导出课堂备份。

本仓库仅发布程序与模板，不包含课堂数据、真实凭据、个人部署配置及原开发仓库历史。公开源码不改变已有网站的私密访问设置。
