# MCP 接口与 ChatGPT 接入

## 服务

网站和 MCP 一同运行，入口：`https://<你的站点>/mcp`。源码在 `app/mcp/route.ts`，共用 `lib/classroom-store.ts` 和 D1。

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

## ChatGPT 接入

Sites 部署优先使用对应 Site 提供的私密插件，完成安装与 OAuth 授权后在聊天中启用。不要改为匿名访问。当前自定义 MCP 界面参见 [OpenAI 官方接入说明](https://developers.openai.com/api/docs/guides/custom-mcp-server)：从 ChatGPT Plugins 创建 MCP 插件、配置认证并在聊天中选择插件，具体入口受账号和工作区权限影响。普通 localhost 不能作为远程 ChatGPT 的直接服务地址。

先验证 list_classrooms，再读取测试课堂。明确授权保存一份测试总结后，确认网页“课堂总结”显示内容；网页约每 6 秒更新分析。

### 总结请求示例

```text
请使用 LectureFlow 插件总结我选择的课堂。
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

生产请求需经平台认证；手填身份头不能证明身份。存储、认证与路由必须一起部署，源码包并非已经连接的 ChatGPT 插件。

## WebMCP

`hooks/use-webmcp.ts` 另提供浏览器当前课堂只读工具，读取页面正在显示的内容。它与远程 `/mcp` 是两个入口，不能互相替代。
