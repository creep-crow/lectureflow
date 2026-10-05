# 本地一键运行

公开版本以本地电脑运行为默认方式，不需要 Sites、Cloudflare 账号、Git 或全局 Node.js。Windows 10/11 使用 x64；Windows 11 ARM64 需支持 x64 仿真，脚本自动使用 x64 运行时。macOS / 带 glibc 的 Linux 支持 x64 与 ARM64。首次安装需要网络，Gemini 转写和所选翻译接口也需要网络。

## Windows：双击即可

1. 从 GitHub 下载源码 ZIP，**解压全部文件**到可写的文件夹。
2. 双击根目录的 **start.cmd**。不要以管理员身份运行。
3. 首次启动会检查 Node.js 和 npm；缺少时从 npmmirror 下载项目内的 Node.js 24，失败自动尝试华为云镜像，核对 SHA256 后解压。随后通过 npmmirror 安装锁定依赖、构建、初始化本地数据库，自动打开浏览器。
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
| 导出全部 Agent 配置 | 双击 `mcp-config.cmd` | `bash start.sh --export-mcp-configs` |
| 导出只读配置 | `start.cmd --export-mcp-configs --read-only` | `bash start.sh --export-mcp-configs --read-only` |
| 输出 Codex TOML | `start.cmd --mcp-config codex` | `bash start.sh --mcp-config codex` |
| 卸载依赖和运行缓存 | 双击 `uninstall.cmd` | `bash uninstall.sh` |
| 预览卸载范围 | `uninstall.cmd -DryRun` | `bash uninstall.sh --dry-run` |

默认访问 `http://127.0.0.1:5173/`。更改端口会记录为下次默认值；浏览器设置按网址分别保存，换端口后可能需要重新填写。依赖和构建正常时重复启动会复用缓存；升级源码后自动检查新依赖、重建并执行未完成迁移。

## 国内下载源

| 下载内容 | 默认源 | 备用 / 校验 |
| --- | --- | --- |
| Node.js 24 与自带 npm | `https://registry.npmmirror.com/-/binary/node` | 失败尝试 `https://repo.huaweicloud.com/nodejs`；使用对应版本的 SHA256 校验文件 |
| npm 项目依赖 | `https://registry.npmmirror.com` | 保留 package-lock.json 中的版本与 integrity 校验 |

下载源只用于补齐运行环境和依赖。安装参数仅作用于本项目，不改全局 npm 配置；下载缓存保存在 `.sites-runtime/npm-cache`，便于复用和卸载清理。锁文件保留 npm 官方地址，由安装器映射到所选 registry，不改写依赖版本或完整性值。

需要改用自己的镜像或官方源时，设置 `LECTUREFLOW_NODE_MIRROR` 和 `LECTUREFLOW_NPM_REGISTRY`，再启动。网址必须为 HTTPS，不含账号密码、查询参数或片段；自定义 Node 源优先于默认主备源。例如 Windows PowerShell：

```powershell
$env:LECTUREFLOW_NODE_MIRROR = 'https://nodejs.org/dist'
$env:LECTUREFLOW_NPM_REGISTRY = 'https://registry.npmjs.org'
.\start.cmd
```

macOS / Linux：

```sh
LECTUREFLOW_NODE_MIRROR=https://nodejs.org/dist \
LECTUREFLOW_NPM_REGISTRY=https://registry.npmjs.org bash start.sh
```

已有依赖可继续复用；需要重新下载时停止服务再使用 `--repair`。默认镜像设置统一保存在 `scripts/download-sources.conf`。镜像使用方式参考 [npmmirror 官方说明](https://npmmirror.com/)，Node 备用源见 [华为云 Node.js 镜像](https://repo.huaweicloud.com/nodejs/)，锁文件 registry 处理见 [npm 官方说明](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/)；于 2026-10-06 实测可访问。

## 数据与备份

- `.wrangler/state`：本地 SQLite 课堂数据库。原文、译文、笔记、总结都在本机；网页和 MCP 共用同一份数据。
- `.sites-runtime/backups`：需要升级已有数据库时创建的 SQL 备份。
- `.sites-runtime/toolchain`：下载的 Node.js；`.sites-runtime/backend` 为本地配置及密钥副本。
- `.sites-runtime/npm-cache`：本项目的 npm 下载缓存，卸载时清理。
- `.env`：可选服务器密钥，首次复制模板，重复启动不会覆盖。
- 浏览器 localStorage：网页填写的连接参数与密钥；保留浏览器数据、相同网址和端口才能恢复。

迁移只执行尚未完成的步骤。脚本可识别以前手工迁移的完整数据库并补记迁移记录；结构不完整时会报错停止，不会删除表重建。

备份前停止后台，再复制 `.wrangler/state`；课堂页面还可导出 Markdown / JSON 备份。将浏览器密钥写入 `.env` 后可随该文件单独备份。源码升级时保留 `.env`、`.wrangler`、`.sites-runtime`，覆盖程序文件即可。不要将本地数据目录和密钥上传到 GitHub。

## 一键卸载

先停止听讲、确认保存完成，关闭启动窗口和这个项目的 MCP 客户端。Windows 双击 `uninstall.cmd`，macOS / Linux 运行 `bash uninstall.sh`。脚本无需下载、Node.js 或管理员权限；检测到仍有安装、网页后台或 MCP 进程时停止清理，请关闭后重新运行。

卸载会删除 `node_modules`、构建产物、项目内下载的 Node.js、npm 缓存、本地后台生成配置和导出的 MCP 配置。**保留 `.wrangler/state` 课堂数据、`.env` 密钥、数据库备份、端口偏好、源码及浏览器设置**，下次启动可以重新安装并继续使用。

脚本不删除系统已有 Node.js、其他项目依赖、全局 npm 缓存或 Agent 的配置文件。无需继续使用 MCP 时，请在 Agent 设置中移除 `lectureflow` 条目，否则客户端仍可能自动重新启动并安装项目。浏览器密钥可在网页“连接设置”中清除。需要彻底删除便携项目时，先备份课堂和密钥，再自行删除剩余项目文件夹。

`uninstall.cmd -DryRun` / `bash uninstall.sh --dry-run` 只预览范围。清理仅限这个源码文件夹，遇到指向外部的父目录链接会停止；嵌套链接仅移除链接本身。

## 本机服务与 MCP

运行的是构建后的程序，后台使用固定本地运行器，不启用开发热重载。专门的本地入口负责启动后台、打开本地课堂、核验请求来源和复用服务。无需开发服务器的模拟登录或 Sites 身份服务。前台与后台均绑定 127.0.0.1；跨站来源与伪造身份头会被拒绝。单台电脑使用一个本地课堂空间，同一系统用户的本地程序可访问其文件和课堂。

`mcp.cmd` 使用 stdio 与桌面客户端交互，所有安装/启动日志输出至 stderr；协议输出独占 stdout。已有网页后台时直接复用；否则准备依赖并启动后台，客户端关闭后结束其自行启动的后台。建议先双击启动网页，再连接 MCP，避免客户端关闭影响正在听讲的课堂。

网页“连接总结助手”可以按 Codex、Claude Desktop / Code、Cursor、VS Code / Copilot 或通用 SDK 复制当前电脑的配置。勾选“只读连接”后，客户端只能读取课堂与笔记，不能保存分析。`mcp-config.cmd` 将全部配置导出到 `.sites-runtime/mcp-configs` 并打开文件夹；再次导出会更新这些生成文件，客户端原有设置不会被改写。更换项目文件夹或端口后请重新生成。

同时连接多个 Agent 时，先启动并保留网页后台窗口，再启动各客户端，避免退出第一个自行启动后台的 MCP 客户端后影响其他连接。多个 Agent 共用本机课堂空间；彼此追加的分析可在网页回看。详见 [多 Agent MCP 接入](MCP.md)。ChatGPT 网页版不能直接启动电脑中的脚本，需要网页版时可导出课堂给 ChatGPT 分析，或另行部署带 HTTPS/OAuth 的远程 MCP。

## 故障处理

- 下载失败：检查能否访问 registry.npmmirror.com 和 repo.huaweicloud.com，或按上文设置自己的 HTTPS 镜像，再运行脚本。
- 依赖缺失或构建异常：先停止后台，再运行 `start.cmd --repair`，不会清除数据库或 `.env`。
- 端口被占用：关闭占用程序，或使用 `--port 5180`。后台只复用当前文件夹的 LectureFlow，不把其他程序误认成课堂。
- 无法使用麦克风：使用脚本显示的 127.0.0.1 地址，允许浏览器麦克风权限；Gemini Key 与模型权限仍需自行配置。
- 同步失败：保留页面并导出课堂备份，确认启动窗口仍在运行，再重试同步。
- 退出窗口后服务残留：优先 Ctrl+C 正常停止。直接强制关闭终端可能中断清理；重新打开脚本前关闭上次启动的后台进程。

Node.js 上游为 [官方 Node.js 24 分发目录](https://nodejs.org/download/release/latest-v24.x/)，默认通过上述国内镜像下载。迁移机制参考 [Cloudflare D1 官方说明](https://developers.cloudflare.com/d1/reference/migrations/)，本地数据库由随项目安装的运行时提供，不需要 Cloudflare 账户。

已在 Windows x64 实测国内镜像安装、备用源切换、构建、迁移、服务复用与真实 stdio 读写，并在临时目录验证卸载保留个人数据及目录链接保护。macOS / Linux 提供对应脚本，尚未实机验证。开发者可显式运行 `npm run test:downloads` 重验真实下载；它仅在 Windows 临时目录测试 Node.js 和少量 npm 依赖，不调用模型。
