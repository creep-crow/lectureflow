import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable, PassThrough } from 'node:stream';
import { inferLegacyMigrations } from './local-db.mjs';
import { allowedLocalRequest, safeReturn } from './local-server.mjs';
import { validatePort } from './local-core.mjs';
import { runStdioBridge } from './mcp-stdio.mjs';

const columns = {
  classrooms: ['id', 'owner', 'title', 'created_at', 'notes', 'revision'],
  segments: ['seq', 'id', 'classroom_id', 'owner', 'offset_ms', 'english', 'chinese'],
  analyses: ['id', 'classroom_id', 'owner', 'title', 'content', 'created_at'],
};
const indexes = ['idx_analyses_classroom_created', 'idx_classrooms_owner_created', 'segments_id_unique', 'idx_segments_classroom_seq'];
test('empty database has no legacy migrations to baseline', () => {
  assert.deepEqual(inferLegacyMigrations({ classrooms: [], segments: [], analyses: [] }, []), []);
});
test('old manual schema is recognized without replaying destructive CREATE statements', () => {
  assert.deepEqual(inferLegacyMigrations(columns, indexes), ['0000_rapid_vulture.sql']);
  assert.deepEqual(inferLegacyMigrations({ ...columns, segments: [...columns.segments, 'translation_group'], classrooms: [...columns.classrooms, 'deleted_at'] }, indexes), ['0000_rapid_vulture.sql', '0001_colorful_changeling.sql', '0002_confused_shadowcat.sql']);
});
test('partial schema or missing unique index stops migration without deleting data', () => {
  assert.throws(() => inferLegacyMigrations({ ...columns, analyses: [] }, indexes), /结构不完整/);
  assert.throws(() => inferLegacyMigrations(columns, indexes.filter(value => value !== 'segments_id_unique')), /结构不完整/);
});
test('local boundary rejects DNS rebinding, remote sockets and cross-site writes', () => {
  const request = { headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(allowedLocalRequest(request, 5173), true);
  for (const headers of [{ ...request.headers, host: 'evil.example:5173' }, { ...request.headers, origin: 'https://evil.example' }, { ...request.headers, 'sec-fetch-site': 'cross-site' }]) assert.equal(allowedLocalRequest({ ...request, headers }, 5173), false);
  assert.equal(allowedLocalRequest({ ...request, socket: { remoteAddress: '10.0.0.1' } }, 5173), false);
});
test('local login return path cannot redirect to an external site or auth loop', () => {
  for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/signin-with-chatgpt', '/signout-with-chatgpt', '/callback']) assert.equal(safeReturn(value), '/');
  assert.equal(safeReturn('/records?search=math'), '/records?search=math');
});
test('port validation preserves explicit ports and rejects privileged or invalid values', () => {
  assert.equal(validatePort('5180'), 5180);
  for (const value of ['0', '80', '65536', '5173garbage', 'http://localhost']) assert.throws(() => validatePort(value));
});

async function bridge(messages, fetchImpl) {
  let output = '';
  await runStdioBridge('http://127.0.0.1:5173', {
    input: Readable.from(messages.map(message => typeof message === 'string' ? message + '\n' : JSON.stringify(message) + '\n')),
    output: new Writable({ write(chunk, encoding, done) { output += chunk; done(); } }), fetchImpl,
  });
  return output.trim().split('\n').filter(Boolean).map(value => JSON.parse(value));
}
const signResponse = () => new Response(null, { status: 302, headers: { 'set-cookie': '__lectureflow_local=test; HttpOnly' } });
test('stdio stays JSON-only, forwards session cookie, preserves IDs and omits notification responses', async () => {
  const requests = [];
  const replies = await bridge([
    { jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 0, method: 'tools/list' },
  ], async (url, options) => {
    if (url.includes('signin')) return signResponse();
    requests.push(options);
    const message = JSON.parse(options.body);
    if (!('id' in message)) return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: '2.0', id: message.id, result: message.method === 'initialize' ? { protocolVersion: '2025-03-26' } : { tools: [] } });
  });
  assert.deepEqual(replies.map(value => value.id), ['init', 0]);
  assert.equal(requests[2].headers['MCP-Protocol-Version'], '2025-03-26');
  assert.equal(requests[2].headers.Cookie, '__lectureflow_local=test');
  assert.equal(requests[2].headers.Origin, 'http://127.0.0.1:5173');
});
test('stdio parse errors, invalid batches and backend failures remain structured MCP errors', async () => {
  const replies = await bridge(['{invalid', [], { jsonrpc: '2.0', id: 3, method: 'tools/list' }], async url => {
    if (url.includes('signin')) return signResponse();
    throw new Error('offline');
  });
  assert.deepEqual(replies.map(value => value.error.code), [-32700, -32600, -32000]);
  assert.equal(replies[2].id, 3);
});
test('stdio refuses remote endpoints and unauthenticated local servers', async () => {
  await assert.rejects(() => runStdioBridge('https://evil.example'), /127.0.0.1/);
  await assert.rejects(() => bridge([], async () => new Response(null, { status: 401 })), /无法连接本地课堂/);
});

test('stdio receives cancellation during an in-flight call without blocking another read', async () => {
  const input = new PassThrough();
  let entered, released, aborted = false;
  const started = new Promise(resolve => { entered = resolve; });
  const completed = new Promise(resolve => { released = resolve; });
  const replies = [];
  const running = runStdioBridge('http://127.0.0.1:5173', {
    input,
    output: new Writable({ write(chunk, encoding, done) { replies.push(JSON.parse(chunk)); released(); done(); } }),
    fetchImpl: async (url, options) => {
      if (url.includes('signin')) return signResponse();
      const message = JSON.parse(options.body);
      if (message.id === 'slow') {
        entered();
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); }, { once: true }));
      }
      return Response.json({ jsonrpc: '2.0', id: message.id, result: {} });
    },
  });
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 'slow', method: 'tools/call' }) + '\n');
  await started;
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 'fast', method: 'ping' }) + '\n');
  await completed;
  input.end(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'slow' } }) + '\n');
  await running;
  assert.equal(aborted, true);
  assert.deepEqual(replies.map(reply => reply.id), ['fast']);
});

test('stdio orders summary writes and forwards large Chinese payloads with read-only scope', async () => {
  const input = Readable.from([0, 1].map(id => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'save_classroom_analysis', arguments: { content: '中'.repeat(100000) } } }) + '\n'));
  let active = 0, peak = 0, replies = 0;
  await runStdioBridge('http://127.0.0.1:5173', {
    input, readOnly: true,
    output: new Writable({ write(chunk, encoding, done) { assert.ok(JSON.parse(chunk).result); replies++; done(); } }),
    fetchImpl: async (url, options) => {
      if (url.includes('signin')) return signResponse();
      assert.equal(options.headers['x-lectureflow-mcp-read-only'], '1');
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setImmediate(resolve));
      active--;
      return Response.json({ jsonrpc: '2.0', id: JSON.parse(options.body).id, result: {} });
    },
  });
  assert.equal(replies, 2);
  assert.equal(peak, 1);
});
