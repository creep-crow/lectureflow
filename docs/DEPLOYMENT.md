# 部署说明

## 运行方式

本项目采用 React、Next.js 风格路由、vinext / Vite、Cloudflare Workers 与 D1。前端、API 和 MCP 共用后端，不能作为纯静态网页运行于 GitHub Pages。

这是干净的源码快照，`.openai/hosting.json` 只保留 `DB`、`mcp` 等通用配置，没有个人项目 ID。运行产生的 `.wrangler`、`.sites-runtime`、`dist` 与密钥文件均被忽略。

## 本地运行

1. 安装 Node.js 22.13+，执行 `npm ci`。
2. 复制 `.env.example` 为 `.env`，填写 `GEMINI_API_KEY` / `DEEPSEEK_API_KEY`，或使用网页连接设置。Gemini 创建步骤见 README 的免费层级教程。
3. 运行 `npm run build` 生成 Wrangler 配置。
4. 首次建库按 README 顺序执行全部三项 SQL 迁移。保留 `.wrangler/state` 可保留课堂；已有库不要重复应用迁移。
5. 运行 `npm run dev`，通过 `/signin-with-chatgpt?return_to=/` 进入模拟账户。

开发边界只允许 loopback 模拟登录，并移除来访请求自带的身份头。不要把开发服务器当作公网生产服务。

## Sites 部署

1. 使用 Sites 创建自己的项目，将平台返回的项目 ID 写入 `.openai/hosting.json` 的 `project_id`，保留 `d1: "DB"`、`capabilities: ["mcp"]`。
2. 通过 Sites 的源码同步与发布流程提交本仓库源码。
3. 构建并打包 Worker 入口、前端资源、`.openai/hosting.json`、全部 D1 迁移和迁移记录。不要把 `.env` 或 `.dev.vars` 放入发布包。
4. 按需在 Sites 运行时设置 `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` 为 secret。浏览器自填密钥优先。
5. 发布后确认 D1 绑定、迁移、登录、创建课堂和重新读取正常。
6. 安装、授权该 Site 提供的私密插件，用 `list_classrooms` / `read_classroom` 验证 MCP；更新时复用该项目的插件。

每位部署者创建自己的 Site、数据库和插件。复制源码不会获得作者的课堂、密钥或部署权限。

## 其他托管环境

生产认证依赖 Sites 注入的 `oai-authenticated-user-id` 等可信头。`lib/server.ts` 不自行验证 OAuth token 或身份头签名。自行部署到普通 Workers / 反向代理时，需要先实现：

- 登录会话与远程 MCP 的 OAuth 验证。
- 清除客户端自带身份头，认证成功后注入可信身份。
- 保护 Worker 原始地址，使客户端不能绕过认证代理。
- D1 绑定与顺序迁移，以可信身份执行每次数据读写。
- HTTPS、登录和回调路由。

这些通用托管适配尚未实现，直接 `wrangler deploy` 不会获得 Sites 的认证保障。`npm start` 运行本地 Worker 构建产物，不等于完成生产登录配置。

## 发布检查

```sh
npm run typecheck
npm run lint
npm test
npm run build
node scripts/verify-release.mjs
```

`verify-release.mjs` 检查产物中是否出现 `.env` 的真实值，并删除构建生成的本地环境侧文件。源码和 Git 历史仍应单独检查。迁移 SQL 仅含结构，无课堂数据。
