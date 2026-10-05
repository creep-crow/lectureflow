import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { root } from './local-core.mjs';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const port = new URL(base).port;
const health = await (await fetch(base + '/api/health')).json();
assert.equal(health.mode, 'local');
const sign = await fetch(base + '/signin-with-chatgpt?return_to=/', { redirect: 'manual' });
const cookie = sign.headers.get('set-cookie').split(';')[0];
async function request(url, payload, method = payload ? 'POST' : 'GET') {
  const response = await fetch(base + url, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: base }, body: payload ? JSON.stringify(payload) : undefined });
  assert.ok(response.ok, `HTTP ${response.status} ${url}`);
  return response.json();
}
const config = await request('/api/local/mcp-config');
assert.ok(config.mcpServers.lectureflow.args.includes(path.join(root, 'scripts/local.mjs')));
const created = await request('/api/classrooms', { title: 'Local MCP integration fixture' });
const sourceId = crypto.randomUUID();
await request('/api/classrooms/' + created.id + '/segments', { segments: [{ id: sourceId, offset_ms: 2000, english: 'The derivative describes the rate of change.', chinese: '导数描述变化率。', translation_group: [] }] });
const command = process.platform === 'win32' ? 'powershell.exe' : 'bash';
const args = process.platform === 'win32'
  ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/bootstrap.ps1'), '--mcp', '--port', port]
  : [path.join(root, 'start.sh'), '--mcp', '--port', port];
const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let outputLines = 0;
let stdoutError;
child.stderr.on('data', () => {});
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  try {
    const message = JSON.parse(line);
    assert.equal(message.jsonrpc, '2.0');
    outputLines++;
    const job = pending.get(message.id);
    assert.ok(job, 'Unexpected stdout message');
    pending.delete(message.id);
    clearTimeout(job.timer);
    job.resolve(message);
  } catch (error) { stdoutError = error; }
});
let sequence = 0;
function rpc(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(stdoutError || new Error('Local MCP timeout')); }, 20000);
    pending.set(id, { resolve, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'local-test', version: '1.0' } });
  assert.equal(init.result.serverInfo.name, 'lectureflow');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const discovered = await rpc('tools/list');
  assert.equal(discovered.result.tools.length, 4);
  const list = await rpc('tools/call', { name: 'list_classrooms', arguments: {} });
  assert.equal(list.result.isError, false);
  assert.ok(list.result.content[0].text.includes(created.id));
  const read = await rpc('tools/call', { name: 'read_classroom', arguments: { classroom_id: created.id } });
  assert.ok(read.result.content[0].text.includes(sourceId));
  const analysis = { classroom_id: created.id, request_id: crypto.randomUUID(), title: '本地 MCP 总结测试', content: '00:02 导数表示变化率。' };
  const saved = await rpc('tools/call', { name: 'save_classroom_analysis', arguments: analysis });
  assert.equal(saved.result.isError, false);
  const retry = await rpc('tools/call', { name: 'save_classroom_analysis', arguments: analysis });
  assert.equal(retry.result.isError, false);
  const notes = await rpc('tools/call', { name: 'read_notes', arguments: { classroom_id: created.id } });
  assert.ok(notes.result.content[0].text.includes(analysis.content));
  const browser = await request('/api/classrooms/' + created.id);
  assert.equal(browser.analyses.length, 1);
  assert.equal(browser.analyses[0].content, analysis.content);
  assert.equal(browser.segments[0].english, 'The derivative describes the rate of change.');
  assert.equal(outputLines, 7);
  assert.equal(stdoutError, undefined);
  child.stdin.end();
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP did not exit after EOF')), 10000);
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(exit, 0);
  assert.equal((await (await fetch(base + '/api/health')).json()).ready, true);
  await request('/api/classrooms/' + created.id, { revision: browser.classroom.revision }, 'DELETE');
  console.log('PASS real bootstrap/stdin/stdout protocol, shared classroom reads, idempotent summary writeback, and reused backend survives MCP exit.');
} finally {
  child.stdin.end();
  for (const { timer } of pending.values()) clearTimeout(timer);
  if (child.exitCode === null) child.kill();
}
