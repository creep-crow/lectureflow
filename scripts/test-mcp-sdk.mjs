import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Run against an already-started local website. No external model calls or keys.
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const sign = await fetch(base + '/signin-with-chatgpt?return_to=/', { redirect: 'manual' });
const cookie = sign.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie, 'Start the local website before this test');
const headers = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
let checks = 0;
const check = (condition, description) => { assert.ok(condition, description); checks++; console.log('PASS ' + description); };
async function api(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  assert.ok(response.ok, `HTTP ${response.status} ${path}`);
  return response.json();
}
const clients = [];
async function stdio(name, readOnly = false) {
  const generated = await api('/api/local/mcp-config?client=generic&readOnly=' + (readOnly ? '1' : '0'));
  const entry = generated.config.mcpServers.lectureflow;
  const transport = new StdioClientTransport({ command: entry.command, args: entry.args, stderr: 'pipe' });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name, version: '1.0.0' }, { capabilities: {} });
  clients.push(client);
  await client.connect(transport, { timeout: 120000 });
  return client;
}
const fixture = await api('/api/classrooms', { title: 'MCP SDK interoperability fixture' });
try {
  const rows = [
    { id: crypto.randomUUID(), offset_ms: 2000, english: 'The derivative describes the rate of change.', chinese: '导数描述变化率。', translation_group: [] },
    { id: crypto.randomUUID(), offset_ms: 6000, english: 'For a constant, the derivative is zero.', chinese: '常数的导数为零。', translation_group: [] },
  ];
  await api(`/api/classrooms/${fixture.id}/segments`, { segments: rows });
  await api(`/api/classrooms/${fixture.id}`, { notes: 'Review the meaning of a derivative.', revision: 0 }, 'PATCH');
  const [first, second, reader] = await Promise.all([stdio('lectureflow-sdk-a'), stdio('lectureflow-sdk-b'), stdio('lectureflow-sdk-read-only', true)]);
  check(first.getServerVersion()?.version === '1.2.0', 'official SDK initializes generated stdio configuration');
  check(first.getServerCapabilities()?.prompts !== undefined, 'server advertises summary prompts');
  const discovery = await first.listTools();
  check(discovery.tools.length === 4 && discovery.tools.every(tool => tool.outputSchema?.type === 'object'), 'SDK discovers four tools with object output schemas');
  const list = await first.callTool({ name: 'list_classrooms', arguments: {} });
  check(list.structuredContent.classrooms.some(item => item.id === fixture.id), 'SDK validates structured classroom list');
  check(JSON.stringify(list.structuredContent) === list.content[0].text, 'text fallback matches structured output');
  const [page, notes] = await Promise.all([
    first.callTool({ name: 'read_classroom', arguments: { classroom_id: fixture.id, limit: 1 } }),
    second.callTool({ name: 'read_notes', arguments: { classroom_id: fixture.id } }),
  ]);
  check(page.structuredContent.segments[0].id === rows[0].id && page.structuredContent.nextCursor !== null, 'concurrent clients preserve transcript pagination');
  check(notes.structuredContent.notes === 'Review the meaning of a derivative.', 'second client reads shared personal notes');
  const tail = await second.callTool({ name: 'read_classroom', arguments: { classroom_id: fixture.id, cursor: page.structuredContent.nextCursor, limit: 1 } });
  check(tail.structuredContent.segments[0].id === rows[1].id && tail.structuredContent.nextCursor === null, 'second client finishes the same classroom pagination');
  check((await first.listPrompts()).prompts[0].name === 'summarize_classroom', 'SDK discovers summary template');
  const prompt = await first.getPrompt({ name: 'summarize_classroom', arguments: { classroom_id: fixture.id, language: 'en' } });
  check(prompt.messages[0].content.text.includes(fixture.id) && prompt.messages[0].content.text.includes('English'), 'SDK fetches classroom-specific English prompt');
  const analysis = { classroom_id: fixture.id, request_id: crypto.randomUUID(), title: 'Shared agent analysis', content: '00:02 Derivatives describe rates of change.' };
  const saved = await first.callTool({ name: 'save_classroom_analysis', arguments: analysis });
  const retry = await second.callTool({ name: 'save_classroom_analysis', arguments: analysis });
  check(saved.structuredContent.id === retry.structuredContent.id, 'different clients reuse request_id without duplicate analysis');
  check((await api(`/api/classrooms/${fixture.id}`)).analyses.length === 1, 'analysis appears once in the website database');
  check((await reader.listTools()).tools.length === 3, 'read-only connection hides write tool');
  await assert.rejects(reader.callTool({ name: 'save_classroom_analysis', arguments: analysis }), /read-only/i);
  checks++;
  console.log('PASS read-only connection rejects manually requested write');
  check((await reader.getPrompt({ name: 'summarize_classroom' })).messages[0].content.text.includes('Do not save'), 'read-only prompt forbids writing');
  const invalid = await first.callTool({ name: 'read_classroom', arguments: { classroom_id: 'invalid' } });
  check(invalid.isError === true && !invalid.structuredContent, 'invalid tool arguments return tool error without fake output');
  const large = await first.callTool({ name: 'save_classroom_analysis', arguments: { ...analysis, request_id: crypto.randomUUID(), title: 'Unicode payload boundary', content: '课'.repeat(100000) } });
  check(large.structuredContent.content.length === 100000, '100,000 Chinese characters survive stdio and HTTP size boundaries');
  await first.close();
  check((await second.callTool({ name: 'read_notes', arguments: { classroom_id: fixture.id } })).structuredContent.analyses.length === 2, 'closing one client leaves another client and web-owned backend usable');

  const httpClient = new Client({ name: 'lectureflow-http-sdk', version: '1.0.0' }, { capabilities: {} });
  clients.push(httpClient);
  await httpClient.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers, redirect: 'error' } }));
  check((await httpClient.listTools()).tools.length === 4, 'official Streamable HTTP SDK connects to authenticated local endpoint');
  check((await httpClient.callTool({ name: 'read_notes', arguments: { classroom_id: fixture.id } })).structuredContent.notes === 'Review the meaning of a derivative.', 'HTTP and stdio clients share identical tool results');
  for (const version of ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']) {
    const rpc = async (method, params = {}) => (await fetch(base + '/mcp', { method: 'POST', headers: { ...headers, 'MCP-Protocol-Version': version }, body: JSON.stringify({ jsonrpc: '2.0', id: version, method, params }) })).json();
    check((await rpc('initialize', { protocolVersion: version })).result.protocolVersion === version, 'negotiates ' + version);
    const result = (await rpc('tools/call', { name: 'list_classrooms', arguments: {} })).result;
    check(version < '2025-06-18' ? !result.structuredContent && Array.isArray(JSON.parse(result.content[0].text)) : !!result.structuredContent.classrooms, 'compatible result shape for ' + version);
  }
  const unsupported = await fetch(base + '/mcp', { method: 'POST', headers: { ...headers, 'MCP-Protocol-Version': '2099-01-01' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
  check(unsupported.status === 400 && (await unsupported.json()).error.code === -32600, 'unsupported HTTP protocol header is rejected');
  const malformed = await fetch(base + '/mcp', { method: 'POST', headers, body: '{broken' });
  check(malformed.status === 400 && (await malformed.json()).error.code === -32700, 'malformed HTTP JSON returns parse error');
  const notification = await fetch(base + '/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  check(notification.status === 202 && await notification.text() === '', 'HTTP notification returns empty 202');
  for (const client of Object.keys({ generic: 1, codex: 1, 'claude-desktop': 1, 'claude-code': 1, cursor: 1, vscode: 1 })) {
    const generated = await api('/api/local/mcp-config?client=' + client + '&readOnly=1');
    check(generated.content.includes('--read-only') && generated.placement && generated.client === client, 'runtime configuration endpoint: ' + client);
  }
  check((await fetch(base + '/api/local/mcp-config?client=unsupported', { headers })).status === 400, 'unsupported config preset is rejected');
  check((await api(`/api/classrooms/${fixture.id}`)).classroom.notes === 'Review the meaning of a derivative.', 'all agent calls preserve original personal notes');
  console.log(`PASS ${checks} MCP SDK interoperability checks; no external model calls.`);
} finally {
  await Promise.allSettled(clients.map(client => client.close()));
  const current = await api(`/api/classrooms/${fixture.id}`);
  await api(`/api/classrooms/${fixture.id}`, { revision: current.classroom.revision }, 'DELETE');
}
