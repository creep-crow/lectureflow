import path from 'node:path';

export const mcpClients = {
  generic: { label: '通用 MCP / Agent SDK', filename: 'mcp.json', placement: '支持 mcpServers 的客户端；Agent SDK 使用其中的 command / args' },
  codex: { label: 'Codex', filename: 'codex.toml', placement: '合并到 ~/.codex/config.toml；重启客户端或新建会话' },
  'claude-desktop': { label: 'Claude Desktop', filename: 'claude_desktop_config.json', placement: '设置 → Developer → Edit Config；合并后重启 Claude Desktop' },
  'claude-code': { label: 'Claude Code', filename: 'claude-code.mcp.json', placement: '合并到工作目录的 .mcp.json；启动 Claude Code 后按提示启用' },
  cursor: { label: 'Cursor', filename: 'cursor.mcp.json', placement: '合并到 ~/.cursor/mcp.json 或项目 .cursor/mcp.json；在 MCP 设置启用' },
  vscode: { label: 'VS Code / Copilot', filename: 'vscode.mcp.json', placement: '合并到 .vscode/mcp.json 或 MCP 用户配置；在 Agent 工具列表启用' },
};

export function generateMcpConfig({ client = 'generic', executable, directory, port = 5173, readOnly = false }) {
  if (!Object.hasOwn(mcpClients, client)) throw new Error('不支持的 MCP 客户端。');
  const args = [path.join(directory, 'scripts/local.mjs'), '--mcp', '--port', String(port), ...(readOnly ? ['--read-only'] : [])];
  const entry = { command: executable, args };
  let config, content, format;
  if (client === 'codex') {
    // TOML basic strings use JSON's escapes for generated executable paths.
    const quote = value => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    content = `[mcp_servers.lectureflow]\ncommand = ${quote(executable)}\nargs = [${args.map(quote).join(', ')}]\nstartup_timeout_sec = 120\ntool_timeout_sec = 60\n`;
    format = 'toml';
  } else {
    config = client === 'vscode' ? { servers: { lectureflow: { type: 'stdio', ...entry } } }
      : { mcpServers: { lectureflow: { ...(client === 'claude-code' || client === 'cursor' ? { type: 'stdio' } : {}), ...entry } } };
    content = JSON.stringify(config, null, 2) + '\n';
    format = 'json';
  }
  return { client, ...mcpClients[client], readOnly, format, content, ...(config ? { config } : {}) };
}
