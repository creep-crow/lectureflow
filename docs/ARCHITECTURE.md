# 架构说明

```mermaid
flowchart LR
  Mic[系统麦克风] --> PCM[16 kHz PCM]
  PCM --> Gemini[Gemini Live]
  Gemini --> English[确认的英文原文]
  English --> DB[(D1)]
  English --> Initial[立即初译]
  DB --> Context[已完成双语上下文]
  Context --> Initial
  Initial --> UI[显示并保存初译]
  UI --> Edit[拼接与润色]
  Context --> Edit
  Edit --> CAS[整组快照校验]
  CAS --> DB
  ChatGPT[ChatGPT 总结] --> MCP[MCP 路由]
  MCP <--> DB
```

## 转写与翻译

Live 默认使用一次性短期令牌，长期密钥不用于浏览器 WebSocket。设备原生采样率通过 AudioWorklet 连续转换为 16 kHz，备用分段模式经服务器转发 WAV。

FastTranslator 对每个确认片段立即请求初译，不等语义断句，慢片段不阻碍其他初译显示。模型可读前面最多 8 个已完成双语单位和约 11,000 字符上下文。

初译队列空闲时约 1.5 秒防抖后整理，最早待处理内容约 6 秒后尝试；持续积压会延后，停止听讲会收尾。窗口最多 20 原始片段、12,000 英文字符和 32,000 中文字符，可重访前面两个完整译文单位，按原片段边界拆分或合并。

整理输出须完整按序覆盖全部 ID。refine 接口比较先前中文和分组快照，原子保存，拒绝覆盖新结果；失败保留初译。drainSaves 先等待最新初译保存，避免旧原文请求响应导致误判。重试同步后可恢复失败整理，英文和时间戳不改写。

## 接口和存储

两个翻译阶段共用网址、协议、模型和密钥池。最多 16 枚密钥，每枚一个活动请求，并发 1–6；轮换空闲密钥，错误后冷却 30 秒，每请求最多尝试 3 枚，仅在当前页面协调。

OpenAI 兼容保留完整聊天端点，模型列表使用同级 /models；DeepSeek 保留原基础网址处理。默认服务端密钥仅用于允许的官方 DeepSeek 地址。SSE 转发字符数与思考状态，完整输出校验后提交，不展示或保存原始推理文本。

classrooms 保存标题、笔记、修订版本和删除时间，segments 保存原文、时间戳、中文和分组，analyses 追加保存 ChatGPT 分析。所有查询按可信 owner 筛选。删除进入回收站，不提供永久清除 UI。生产身份来自 Sites，本地仅模拟 loopback 账户。

## 关键代码

| 位置 | 职责 |
| --- | --- |
| `app/page.tsx` / `hooks/use-classroom.ts` | 课堂页面、收音、保存与翻译协调 |
| `lib/gemini-live.ts` / `lib/gemini-chunks.ts` | 转写、重连与收尾 |
| `public/pcm-capture.js` | 连续音频转换 |
| `lib/fast-translation.ts` / `lib/save-queue.ts` | 初译、整理与保存等待 |
| `lib/translation-*.ts` | 协议、网址、密钥池及 SSE |
| `app/api/classrooms` / `lib/classroom-store.ts` | 课堂读写、分页、冲突与原子保存 |
| `app/records` | 回看、管理和回收站 |
| `app/mcp/route.ts` | 远程 MCP |
| `hooks/use-webmcp.ts` | 浏览器课堂只读工具 |
| `drizzle` | D1 迁移 |

音频不持久保存，未同步文本和未发送音频不保证崩溃恢复；localStorage 连接设置并非课堂备份。
