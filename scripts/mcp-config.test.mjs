import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { generateMcpConfig, mcpClients } from './mcp-config.mjs';

const options = { executable: path.resolve('工具 "quoted"/node.exe'), directory: path.resolve('中文课堂 路径'), port: 5180 };
test('client presets preserve spaces and Unicode paths without shell quoting', () => {
  for (const client of Object.keys(mcpClients).filter(name => name !== 'codex')) {
    const generated = generateMcpConfig({ ...options, client });
    const parsed = JSON.parse(generated.content);
    const entry = (parsed.mcpServers || parsed.servers).lectureflow;
    assert.equal(entry.command, options.executable);
    assert.deepEqual(entry.args, [path.join(options.directory, 'scripts/local.mjs'), '--mcp', '--port', '5180']);
    if (['vscode', 'cursor', 'claude-code'].includes(client)) assert.equal(entry.type, 'stdio');
    assert.ok(generated.placement && generated.filename);
  }
});
test('Codex uses TOML with escaped paths, and read-only is an executable argument', () => {
  const generated = generateMcpConfig({ ...options, client: 'codex', readOnly: true });
  assert.ok(generated.content.startsWith('[mcp_servers.lectureflow]\n'));
  assert.equal(JSON.parse(generated.content.match(/^command = (.+)$/m)[1]), options.executable);
  assert.equal(JSON.parse(generated.content.match(/^args = (.+)$/m)[1]).at(-1), '--read-only');
  assert.match(generated.content, /startup_timeout_sec = 120/);
  assert.throws(() => generateMcpConfig({ ...options, client: '__proto__' }), /不支持/);
});

const source = await readFile(new URL('../lib/mcp-protocol.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { toolResult, summaryMessages, MCP_PROTOCOLS } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
test('structured results retain equivalent text while old clients keep their response shape', () => {
  const rows = [{ id: 'a', title: '课堂' }];
  const latest = toolResult('list_classrooms', rows, '2025-11-25');
  assert.deepEqual(latest.structuredContent, { classrooms: rows });
  assert.deepEqual(JSON.parse(latest.content[0].text), latest.structuredContent);
  for (const protocol of ['2024-11-05', '2025-03-26']) {
    const older = toolResult('list_classrooms', rows, protocol);
    assert.equal(older.structuredContent, undefined);
    assert.deepEqual(JSON.parse(older.content[0].text), rows);
  }
  assert.equal(MCP_PROTOCOLS.includes('2025-11-25'), true);
});
test('summary template requires paginated evidence and respects read-only scope', () => {
  const prompt = summaryMessages({ classroom_id: 'fixture', language: 'en' }, true).messages[0].content.text;
  assert.match(prompt, /nextCursor is null/);
  assert.match(prompt, /Answer in English/);
  assert.match(prompt, /read-only/);
  assert.doesNotMatch(prompt, /Save with save_classroom_analysis/);
  assert.match(summaryMessages({}).messages[0].content.text, /ask the user to select/);
});
