# MCP 接口与 ChatGPT 接入

## 默认：本地 stdio 服务

公开版本包含独立 stdio 入口，不需要 Sites 插件或云端身份认证。网页和 MCP 共享本机课堂数据库；首次连接前建议先完成一次 `start.cmd` / `bash start.sh` 启动，避免桌面客户端等待安装时超时。

Windows 客户端执行根目录的 `mcp.cmd`。macOS / Linux 客户端执行 `bash`，参数为项目内 `start.sh` 的绝对路径及 `--mcp`。它会复用已运行的网页后台；后台不存在时自动准备并启动。所有启动日志输出到 stderr，stdout 只包含 MCP JSON-RPC 消息。关闭客户端会结束由该客户端自行启动的后台，已在网页启动窗口运行的后台保持运行。

网页“连接总结助手 → 查看本地 MCP 配置”会生成当前电脑可用的 `command` / `args`。可直接复制到支持 `mcpServers` 的客户端；绝对路径由运行时生成，源码不包含作者电脑路径。例如：

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

支持本地 MCP 的桌面客户端应将启动等待时间设为至少 60 秒；第一次请先运行网页入口完成安装。客户端设置方法以其当前官方文档为准。协议遵循 [MCP stdio 规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)：UTF-8、每行一个 JSON-RPC 消息、日志走 stderr。

## 共用 HTTP 后端

本地内部入口为 `http://127.0.0.1:5173/mcp`（端口可配置），需本地会话 Cookie；推荐桌面客户端使用 stdio 包装，不必手填 Cookie。源码在 `app/mcp/route.ts`，共用 `lib/classroom-store.ts`。本地服务只监听 127.0.0.1；来源与 Host 校验、会话及身份注入由 `scripts/local-server.mjs` 完成，不依赖 Sites。

实现为无状态 Streamable HTTP 的 JSON 响应形式，仅 POST，不维护会话。支持 initialize、ping、tools/list、tools/call 和通知；协商版本包括 2025-06-18、2025-03-26、2024-11-05。GET / DELETE 返回 405。

工具发现不包含私密课堂数据；执行课堂工具需要可信用户身份，数据按该用户筛选。回收站课堂不能读取或追加分析。

## 工具

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `list_classrooms` | `{}` | 列出当前用户最近最多 100 堂未删除课堂 |
| `read_classroom` | `classroom_id`；可选 `cursor`、`limit` | 分页读取原文、译文和分析；limit 默认 100，范围 1–100 |
| `read_notes` | `classroom_id` | 读取手写笔记和已存分析 |
| `save_classroom_analysis` | `classroom_id`、`request_id`、`title`、`content` | 追加总结，不修改原文、译文或个人笔记 |

课堂与请求 ID 使用 UUID，标题最多 160 字符，分析最多 100,000 字符。重试同一分析时复用 request_id；同一 ID 配不同内容会被拒绝。

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

ChatGPT 在聊天中发起分析，不承担实时翻译，不会被网站静默调用；无需 OpenAI API Key。

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
