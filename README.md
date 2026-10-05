# LectureFlow · 全英课堂听讲助手

通过系统麦克风实时转写英文课堂，先显示中文初译，再结合前文拼接、断句和润色；使用 ChatGPT 通过 MCP 读取课堂并保存总结分析。



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

Gemini 负责转写，所选翻译模型负责中文翻译，ChatGPT 仅负责总结分析。总结由用户在聊天中发起，并非自动后台生成。

## 免费层级 Gemini API Key：简短教程
因为google ai studio的gemini3.5 transcribe live即使是免费层级也可以无限额使用，所以本项目转写部分使用该模型。

1. 打开 [Google AI Studio](https://aistudio.google.com/)，使用 Google 账号登录，按页面提示完成首次使用设置。
2. 进入 [API Keys 页面](https://aistudio.google.com/api-keys)。新用户可能已有默认项目和密钥；也可点击 **Create API key**，选择或创建自己的项目。已有 Cloud 项目需先在 Projects 导入。
3. 在项目/密钥列表确认 **Billing Tier 为 Free Tier**。如只想使用免费层级，不进行 **Set up billing / Upgrade**，也不要选择已经关联付费账单的项目。
4. 复制密钥，在 LectureFlow 的“连接设置 → Gemini API Key”中粘贴，点击“保存并应用”；本地开发也可填入 `.env` 的 `GEMINI_API_KEY`。不要将密钥写进仓库。



## 文档

- [使用说明](docs/USER_GUIDE.md)：听讲、连接设置、课堂记录和失败恢复。
- [部署说明](docs/DEPLOYMENT.md)：本地运行、Sites、数据库与认证要求。
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

开发服务器启动并完成本地迁移后，可运行 `npm run test:integration`。功能基线包含 52 项确定性测试及 71 项本地 API 检查；真实 Gemini Live 和 DeepSeek 调用曾验证通过。真实接口脚本会使用自己的密钥和额度，不属于普通测试。

## 部署与 MCP

建议通过 Sites 运行网站、D1 与 `/mcp`，使用平台 OAuth 和可信身份边界。`.openai/hosting.json` 为通用模板，没有个人 Site ID；创建自己的 Site 后填写平台返回的项目 ID。详见[部署说明](docs/DEPLOYMENT.md)。

MCP 入口为 `https://<你的站点>/mcp`，代码位于 `app/mcp/route.ts`。本仓库不包含独立 stdio 服务；必须同时部署存储和认证，单独复制路由无法运行。

## 数据与限制

不持久保存原始录音；原文、译文、笔记和分析保存在 D1。自填密钥以明文存储于当前浏览器 localStorage，可在连接设置中清除，不写入课堂记录。翻译请求会发送当前原文与有限双语上下文至所选服务。

二次润色会增加调用。多密钥并发仅在当前页面协调，不能绕过共享账户额度。同步失败保留页面内容，但不能保证崩溃时恢复未保存文本；请重试同步或导出课堂备份。

本仓库仅发布程序与模板，不包含课堂数据、真实凭据、个人部署配置及原开发仓库历史。公开源码不改变已有网站的私密访问设置。
