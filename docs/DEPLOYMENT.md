# 部署说明

## 默认：独立本地运行

公开仓库针对自己的电脑运行开发；作者自用的 Sites 版本单独维护。普通用户按 [本地一键运行](LOCAL.md) 双击 `start.cmd` 即可。脚本负责 Node.js / npm、锁定依赖、构建、数据库迁移和打开网页，不需要 Sites 或 Cloudflare 账号。

`npm start` / `node scripts/local.mjs` 为同一入口，适合已安装合适 Node.js / npm 的用户。`npm run setup` 只准备环境；`npm run mcp` 启动 stdio MCP。macOS / Linux 使用 `bash start.sh`，自动补齐环境。

## 本地组成

前端使用 React，路由与构建使用 vinext / Vite。构建后的后端由随项目安装的 Miniflare / workerd 在本机执行，D1 本地实现将课堂保存到 SQLite；Wrangler 仅执行数据库迁移。这些依赖不调用 Cloudflare 账号，也不创建远程数据库。

`scripts/local-server.mjs` 提供独立本地访问入口与会话认证，后台监听另一个本机端口。网页、语音/翻译 API 代理、MCP 工具均通过该入口访问。`local-worker.mjs` 加载固定构建产物，没有开发模式的文件监听或热重载，避免 POST 请求被自动重启打断。原 Sites 认证辅助文件是兼容代码，本地入口不调用 Sites 登录或身份服务。

`scripts/local-db.mjs` 从构建产物生成本地配置，在相同 `.wrangler/state` 上按迁移记录更新。完整手工建库会先备份并补记已完成步骤，不回放建表语句。若发现半完成的结构，停止并提示处理，保留数据库。

## 开发模式

需要 Node.js 22.13+ / npm，或先完成一键脚本环境准备：

```sh
npm ci
npm run setup
npm run dev
```

开发模式沿用旧的 loopback 模拟登录入口 `/signin-with-chatgpt?return_to=/`，方便调试。日常使用通过 `npm start` 或一键脚本运行构建产物。不要同时在同一端口运行开发服务和本地启动入口。

## 可选远程托管

GitHub Pages 不能运行后端。公开版本不包含一键公网部署适配。要部署到普通 Cloudflare Workers、其他服务器或反向代理，需要为远程环境补齐：

- 验证过的登录会话与 MCP OAuth，以及用户数据隔离。
- 清除客户端提供的身份头，只在认证后注入可信身份。
- 保护 Worker 原始地址，防止绕过认证代理。
- 远程数据库绑定、顺序迁移、备份与 HTTPS 回调。

`lib/server.ts` 读取可信身份头，本身不验证 OAuth token。不要把本地访问入口监听为 0.0.0.0，也不要直接用隧道公开单用户本地会话。远程适配应在认证完成后使用不同的持久化配置。

仓库保留通用 `.openai/hosting.json` 以兼容原构建资源布局，没有作者个人 Site ID；本地运行不需要填写项目 ID。需要 Sites 托管时必须为自己创建项目、数据库和私密插件，并按平台流程管理认证。该流程属于可选远程适配，公开版默认不使用。

## 验证

```sh
npm run typecheck
npm run lint
npm test
npm run build
node scripts/verify-release.mjs
```

启动本地后台后可运行 `npm run test:integration`。真实 Gemini / 翻译接口测试会使用自己的密钥和额度。发布源码时排除 `.env`、`.wrangler`、`.sites-runtime`、课堂数据及构建缓存。

本地后台运行时执行 `node scripts/test-local-integration.mjs`，检查真实 stdio 启动、共享数据、总结写回和客户端退出。自定义端口时设置 `TEST_URL` 为该地址。

`npm run test:mcp` 使用官方 MCP SDK 验证多个 stdio Agent 连接和认证后的 Streamable HTTP 连接。多客户端接入前请先启动网页，配置导出与 SDK 示例见 [多 Agent MCP 接入](MCP.md)。
