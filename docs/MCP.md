# 多 Agent MCP 接入

## 默认：本地 stdio 服务

公开版本包含标准 MCP stdio 入口，支持 Codex、Claude Desktop、Claude Code、Cursor、VS Code / Copilot，以及能运行本地 stdio 服务的 Agent SDK。不需要 Sites 插件或 OpenAI API Key。模型由所选客户端提供，MCP 只负责课堂读写，不会调用模型。

先完成一次 `start.cmd` / `bash start.sh` 启动，再接入客户端，避免安装依赖期间连接超时。多个 Agent 同时使用时，先启动并保留网页后台窗口。它们共享同一课堂空间，关闭其中一个 MCP 连接不影响网页后台和其他连接。

Windows 客户端执行根目录的 `mcp.cmd`。macOS / Linux 客户端执行 `bash`，参数为项目内 `start.sh` 的绝对路径及 `--mcp`。它会复用已运行的网页后台；后台不存在时自动准备并启动。所有启动日志输出到 stderr，stdout 只包含 MCP JSON-RPC 消息。关闭客户端会结束由该客户端自行启动的后台，已在网页启动窗口运行的后台保持运行。

网页“连接总结助手”选择目标客户端后，会生成当前电脑可用的配置和配置位置。绝对路径由运行时生成，源码不包含作者电脑路径。通用 JSON 示例：

```json
{
  "mcpServers": {
    "lectureflow": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["D:\\lectureflow\\scripts\\local.mjs", "--mcp", "--port", "5173"]
    }
  }
}
```

若使用自动下载的 Node.js，`command` 指向项目的本地运行时；无需全局安装。不要手动照抄示例路径。

不要在客户端运行带引号拼接的整条命令；`command` 和每个 `args` 元素分别填写。空格、中文路径已经正确转义。不要照抄示例路径；移动源码目录或更改端口后重新生成。

## 各客户端配置

| 客户端 | 生成选项 | 合并位置与格式 |
| --- | --- | --- |
| Codex | `codex` | `~/.codex/config.toml` 中的 `[mcp_servers.lectureflow]`；TOML |
| Claude Desktop | `claude-desktop` | Settings → Developer → Edit Config；JSON `mcpServers` |
| Claude Code | `claude-code` | 工作目录 `.mcp.json`；JSON `mcpServers`，`type: stdio` |
| Cursor | `cursor` | `~/.cursor/mcp.json` 或项目 `.cursor/mcp.json`；JSON `mcpServers` |
| VS Code / Copilot | `vscode` | `.vscode/mcp.json` 或 MCP 用户配置；JSON `servers` |
| 通用客户端 / Agent SDK | `generic` | JSON `mcpServers`；SDK 使用其中 `command` / `args` 创建 stdio 传输 |

只合并 `lectureflow` 服务，保留已有服务器与设置。按客户端提示信任/启用服务，重启或新开会话，然后查看工具列表。客户端需支持本地 MCP，模型和 Agent 模式需自行启用；生成配置不代表已经修改或安装了这些应用。

Windows 双击 `mcp-config.cmd` 导出全部配置并打开 `.sites-runtime/mcp-configs`。macOS / Linux：

```sh
bash start.sh --export-mcp-configs
# 输出单个配置到 stdout，启动日志仍走 stderr
bash start.sh --mcp-config codex
# Windows 等价入口：start.cmd --mcp-config codex
```

Codex 配置示例（使用实际生成的路径）：

```toml
[mcp_servers.lectureflow]
command = "C:\\Program Files\\nodejs\\node.exe"
args = ["D:\\lectureflow\\scripts\\local.mjs", "--mcp", "--port", "5173"]
startup_timeout_sec = 120
tool_timeout_sec = 60
```

VS Code 的顶层键是 `servers`，不能直接粘贴通用 `mcpServers` 配置。其他支持 stdio 的 Agent 按自己的 SDK 接口传入生成的命令与参数即可。

配置格式参考 [Codex 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)、[Claude Desktop 本地接入教程](https://modelcontextprotocol.io/docs/develop/connect-local-servers)、[Claude Code 官方说明](https://code.claude.com/docs/en/mcp)、[Cursor 官方说明](https://cursor.com/docs/mcp)与 [VS Code 官方配置说明](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)，于 2026-10-06 核对。已用官方 SDK 验证协议互通；未逐一安装这些桌面应用实测，界面位置可能随版本变化。

## 只读连接

网页勾选“只读连接”会在启动参数增加 `--read-only`；也可导出全部只读配置：

```sh
start.cmd --export-mcp-configs --read-only
# macOS / Linux：bash start.sh --export-mcp-configs --read-only
```

该连接只提供三个读取工具，手动请求 `save_classroom_analysis` 也会被拒绝。总结提示模板改为只在聊天中展示结果。普通连接仍可在用户请求时追加分析。不同连接共用同一数据库，取消只读参数即可新建普通连接；这是连接的功能限制，不是对本机程序的文件访问隔离。

## 自建 Agent SDK

支持 MCP stdio 的 Agent SDK 可以直接启动生成配置中的 `command` / `args`，再把发现的工具提供给自己的 Agent。MCP 与聊天模型解耦，不要求某一家模型供应商。下面用官方 JavaScript SDK 验证读取，不调用模型：

```js
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const config = JSON.parse(await readFile(".sites-runtime/mcp-configs/mcp.json", "utf8"));
const entry = config.mcpServers.lectureflow;
const client = new Client({ name: "my-agent", version: "1.0" }, { capabilities: {} });
try {
  await client.connect(new StdioClientTransport(entry));
  console.log(await client.listTools());
  console.log(await client.callTool({ name: "list_classrooms", arguments: {} }));
} finally {
  await client.close();
}
```

SDK 已作为开发依赖锁定；自建项目请安装其兼容版本。`npm run test:mcp` 在已经启动的本地网页上验证 stdio、HTTP 和多客户端共享；自定义端口通过 `TEST_URL` 设置。

## 共用 HTTP 后端

本地内部入口为 `http://127.0.0.1:5173/mcp`（端口可配置），需本地会话 Cookie；推荐桌面客户端使用 stdio 包装，不必手填 Cookie。源码在 `app/mcp/route.ts`，共用 `lib/classroom-store.ts`。本地服务只监听 127.0.0.1；来源与 Host 校验、会话及身份注入由 `scripts/local-server.mjs` 完成，不依赖 Sites。

实现为无状态 Streamable HTTP 的 JSON 响应形式，仅 POST，不维护 MCP 会话。支持 initialize、ping、tools/list、tools/call、prompts/list、prompts/get 和通知；协商版本包括 2025-11-25、2025-06-18、2025-03-26、2024-11-05。GET / DELETE 返回 405，通知返回空 202。遵循 [MCP 传输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。

协议 2025-06-18 与 2025-11-25 返回 `structuredContent`，工具发现包含 `outputSchema`，同时提供内容相同的 JSON 文本作为兼容回退。`list_classrooms` 的结构化结果为 `{ "classrooms": [...] }`；其他工具直接返回对应对象。旧协议保留原有 JSON 文本，其中课堂列表仍为数组，避免破坏旧客户端。

stdio 在初始化后可并发读取；同一连接的总结写入按顺序处理，多个连接通过 SQLite 与 `request_id` 保证重试不重复。支持 `notifications/cancelled` 取消排队/进行中的请求，取消不能撤销已提交的总结。每行请求与 HTTP 请求体上限均为 1,000,000 UTF-8 字节；stdio 最多 64 个在途请求，单次后台请求超时 30 秒。不要在同一连接复用仍在处理的 JSON-RPC ID。

工具发现不包含私密课堂数据；执行课堂工具需要可信用户身份，数据按该用户筛选。回收站课堂不能读取或追加分析。

## 工具

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `list_classrooms` | `{}` | 列出当前用户最近最多 100 堂未删除课堂 |
| `read_classroom` | `classroom_id`；可选 `cursor`、`limit` | 分页读取原文、译文和分析；limit 默认 100，范围 1–100 |
| `read_notes` | `classroom_id` | 读取手写笔记和已存分析 |
| `save_classroom_analysis` | `classroom_id`、`request_id`、`title`、`content` | 追加总结，不修改原文、译文或个人笔记 |

课堂与请求 ID 使用 UUID，标题最多 160 字符，分析最多 100,000 字符。重试同一分析时复用 request_id；同一 ID 配不同内容会被拒绝。

### 总结模板

支持 MCP Prompts 的客户端可选择 `summarize_classroom`，可选参数为 `classroom_id`（UUID）和 `language`（`zh-CN` 或 `en`，默认中文）。未提供课堂时先列出并让用户选择。模板引导完整分页读取、读取笔记、引用时间戳、区分事实与补充解释，并将课堂文本视为资料。普通连接只在用户请求保存时写入；只读连接只展示总结。

模板不会自行调用模型。未提供 Prompts 界面的客户端可直接使用下方总结请求，所有工具仍然可用。

### 分页与分组

连续传入 `read_classroom` 返回的 nextCursor，直至 null；只读第一页不能声称总结了整堂课。原始片段包含 id、offset_ms、english、chinese、translation_group。合并译文保存在分组首段，其他成员中文可为空，并不代表翻译失败。分组可能跨页，英文和时间戳保持原始值。

## ChatGPT 与本地客户端的区别

Codex 等支持 stdio 的桌面客户端可以直接执行本地入口。**ChatGPT 网页版不能启动电脑里的脚本，也不能直接访问 localhost。** 可导出课堂作为分析材料；若一定要让网页版通过工具写回，需要另行部署具备 HTTPS/OAuth 的远程 MCP。当前自定义远程 MCP 界面参见 [OpenAI 官方说明](https://developers.openai.com/api/docs/guides/custom-mcp-server)，具体入口受账号和工作区权限影响。

本地脚本不会自动注册 Sites，不会将课堂传入云端存储。作者自用的 Sites 插件属于单独维护的版本。模型在客户端读取课堂时，课堂内容仍会发送至该客户端所用模型服务。

先验证 list_classrooms，再读取测试课堂。明确授权保存一份测试总结后，确认网页“课堂总结”显示内容；网页约每 6 秒更新分析。

### 总结请求示例

```text
请使用 LectureFlow MCP 工具总结我选择的课堂。
先列出课堂并确认目标，读取全部分页和个人笔记，然后给出课堂结构、主要知识点、重点公式、难点及复习问题。
引用原文时间戳，区分课堂事实与补充解释，说明资料不完整的部分。
通过 save_classroom_analysis 追加保存总结，勿修改原始转写或个人笔记。
```

所选 Agent 在客户端中发起分析，不承担实时翻译，不会被网站静默调用。各客户端可用同一套课堂工具；LectureFlow 无需 OpenAI API Key。

## JSON-RPC 请求示例

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

下面的 UUID 是占位，应替换为 list_classrooms 返回的课堂 ID：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "read_classroom",
    "arguments": {
      "classroom_id": "00000000-0000-4000-8000-000000000001",
      "cursor": 0,
      "limit": 100
    }
  }
}
```

本地请求经过会话入口，stdio 包装自动获取会话；手填身份头不会使本地网页认证通过。远程托管需另行实现可信认证边界，不能直接公网暴露本地服务或 Worker 原始地址。

## WebMCP

`hooks/use-webmcp.ts` 另提供浏览器当前课堂只读工具，读取页面正在显示的内容。它与远程 `/mcp` 是两个入口，不能互相替代。
