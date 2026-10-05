# 本地一键运行

公开版本以本地电脑运行为默认方式，不需要 Sites、Cloudflare 账号、Git 或全局 Node.js。Windows 10/11 使用 x64；Windows 11 ARM64 需支持 x64 仿真，脚本自动使用 x64 运行时。macOS / 带 glibc 的 Linux 支持 x64 与 ARM64。首次安装需要网络，Gemini 转写和所选翻译接口也需要网络。

## Windows：双击即可

1. 从 GitHub 下载源码 ZIP，**解压全部文件**到可写的文件夹。
2. 双击根目录的 **start.cmd**。不要以管理员身份运行。
3. 首次启动会检查 Node.js 和 npm；缺少时从 nodejs.org 下载项目内的 Node.js 24，核对 SHA256 后解压。随后安装锁定依赖、构建、初始化本地数据库，自动打开浏览器。
4. 在网页“连接设置”填写 Gemini 和翻译接口的密钥。无需填写 Sites ID 或登录 ChatGPT。

保留启动窗口。按 Ctrl+C 停止本次启动的后台；再次启动保留课堂与设置。重复双击会打开已有服务，不会再启动一份后台。

## macOS / Linux

在解压后的目录运行：

```sh
bash start.sh
```

脚本优先使用已有合适的 Node.js / npm，否则下载并校验项目内的 Node.js 24。首次下载需要系统 curl、tar 及 sha256sum 或 shasum；桌面环境缺少自动打开工具时，手动访问终端显示的网址即可。

## 常用选项

| 用途 | Windows | macOS / Linux |
| --- | --- | --- |
| 默认启动 | 双击 `start.cmd` | `bash start.sh` |
| 安装、构建、迁移后退出 | `start.cmd --prepare-only` | `bash start.sh --prepare-only` |
| 重新安装依赖并重建 | `start.cmd --repair` | `bash start.sh --repair` |
| 不自动打开网页 | `start.cmd --no-open` | `bash start.sh --no-open` |
| 更改端口 | `start.cmd --port 5180` | `bash start.sh --port 5180` |
| 本地 stdio MCP | 由客户端执行 `mcp.cmd` | 由客户端执行 `bash start.sh --mcp` |

默认访问 `http://127.0.0.1:5173/`。更改端口会记录为下次默认值；浏览器设置按网址分别保存，换端口后可能需要重新填写。依赖和构建正常时重复启动会复用缓存；升级源码后自动检查新依赖、重建并执行未完成迁移。

## 数据与备份

- `.wrangler/state`：本地 SQLite 课堂数据库。原文、译文、笔记、总结都在本机；网页和 MCP 共用同一份数据。
- `.sites-runtime/backups`：需要升级已有数据库时创建的 SQL 备份。
- `.sites-runtime/toolchain`：下载的 Node.js；`.sites-runtime/backend` 为本地配置及密钥副本。
- `.env`：可选服务器密钥，首次复制模板，重复启动不会覆盖。
- 浏览器 localStorage：网页填写的连接参数与密钥；保留浏览器数据、相同网址和端口才能恢复。

迁移只执行尚未完成的步骤。脚本可识别以前手工迁移的完整数据库并补记迁移记录；结构不完整时会报错停止，不会删除表重建。

备份前停止后台，再复制 `.wrangler/state`；课堂页面还可导出 Markdown / JSON 备份。将浏览器密钥写入 `.env` 后可随该文件单独备份。源码升级时保留 `.env`、`.wrangler`、`.sites-runtime`，覆盖程序文件即可。不要将本地数据目录和密钥上传到 GitHub。

## 本机服务与 MCP

运行的是构建后的程序，后台使用固定本地运行器，不启用开发热重载。专门的本地入口负责启动后台、打开本地课堂、核验请求来源和复用服务。无需开发服务器的模拟登录或 Sites 身份服务。前台与后台均绑定 127.0.0.1；跨站来源与伪造身份头会被拒绝。单台电脑使用一个本地课堂空间，同一系统用户的本地程序可访问其文件和课堂。

`mcp.cmd` 使用 stdio 与桌面客户端交互，所有安装/启动日志输出至 stderr；协议输出独占 stdout。已有网页后台时直接复用；否则准备依赖并启动后台，客户端关闭后结束其自行启动的后台。建议先双击启动网页，再连接 MCP，避免客户端关闭影响正在听讲的课堂。

网页“连接总结助手”可以复制当前电脑的 MCP 配置及总结请求。详见 [本地 MCP 接入](MCP.md)。本地 stdio 能用于支持它的桌面客户端；ChatGPT 网页版不能直接启动电脑中的脚本。需要网页版时可导出课堂给 ChatGPT 分析，或另行部署带 HTTPS/OAuth 的远程 MCP，不能直接把 localhost 填作云端地址。

## 故障处理

- 下载失败：检查能否访问 nodejs.org 和 registry.npmjs.org，再运行脚本。
- 依赖缺失或构建异常：先停止后台，再运行 `start.cmd --repair`，不会清除数据库或 `.env`。
- 端口被占用：关闭占用程序，或使用 `--port 5180`。后台只复用当前文件夹的 LectureFlow，不把其他程序误认成课堂。
- 无法使用麦克风：使用脚本显示的 127.0.0.1 地址，允许浏览器麦克风权限；Gemini Key 与模型权限仍需自行配置。
- 同步失败：保留页面并导出课堂备份，确认启动窗口仍在运行，再重试同步。
- 退出窗口后服务残留：优先 Ctrl+C 正常停止。直接强制关闭终端可能中断清理；重新打开脚本前关闭上次启动的后台进程。

Node.js 下载来源：[官方 Node.js 24 分发目录](https://nodejs.org/download/release/latest-v24.x/)。迁移机制参考 [Cloudflare D1 官方说明](https://developers.cloudflare.com/d1/reference/migrations/)，本地数据库由随项目安装的运行时提供，不需要 Cloudflare 账户。

本次已在 Windows x64 实测首次补齐依赖、构建、迁移、服务复用与真实 stdio 读写；macOS / Linux 脚本通过语法检查，尚未实机验证。
