import { createInterface } from 'node:readline';

const maxBytes = 1_000_000;
export async function runStdioBridge(origin, { input = process.stdin, output = process.stdout, fetchImpl = fetch, readOnly = false } = {}) {
  const target = new URL(origin);
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password) throw new Error('本地 MCP 只连接 127.0.0.1。');
  const sign = await fetchImpl(origin + '/signin-with-chatgpt?return_to=/', { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  const cookie = sign.headers.get('set-cookie')?.split(';')[0];
  if (sign.status !== 302 || !cookie) throw new Error('无法连接本地课堂，请先运行 start.cmd。');
  const lines = createInterface({ input, crlfDelay: Infinity });
  let protocol = '2025-11-25';
  let initialization = Promise.resolve();
  let writes = Promise.resolve();
  const active = new Map(), jobs = new Set();
  const send = data => output.write(JSON.stringify(data) + '\n');
  const validId = id => typeof id === 'string' || typeof id === 'number' && Number.isFinite(id);
  async function forward(message, state, barrier) {
    await barrier;
    if (state.cancelled) return;
    try {
      const response = await fetchImpl(origin + '/mcp', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Cookie: cookie, Origin: origin, 'MCP-Protocol-Version': protocol,
          ...(readOnly ? { 'x-lectureflow-mcp-read-only': '1' } : {}) },
        body: JSON.stringify(message), signal: AbortSignal.any([state.controller.signal, AbortSignal.timeout(30000)]), redirect: 'error',
      });
      if (!('id' in message) || state.cancelled) return;
      const data = await response.json();
      if (data.jsonrpc !== '2.0' || data.id !== message.id || (!('result' in data) && !('error' in data))) throw new Error('Invalid backend response');
      if (message.method === 'initialize' && data.result?.protocolVersion) protocol = data.result.protocolVersion;
      send(data);
    } catch {
      if ('id' in message && !state.cancelled) send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Local classroom unavailable. Restart LectureFlow and reconnect. An interrupted save may have completed; retry with the same request_id.' } });
    }
  }
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method || ('id' in message && !validId(message.id))) {
      if (message?.jsonrpc === '2.0' && validId(message.id) && ('result' in message || 'error' in message) && !('method' in message)) continue;
      send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }); continue;
    }
    if (Buffer.byteLength(line) > maxBytes) {
      if ('id' in message) send({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Request too large' } });
      continue;
    }
    if (!('id' in message) && message.method === 'notifications/cancelled') {
      const pending = active.get(message.params?.requestId);
      if (pending && pending.method !== 'initialize') { pending.cancelled = true; pending.controller.abort(); }
      continue;
    }
    if ('id' in message && active.has(message.id)) { send({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Request id already active' } }); continue; }
    if (jobs.size >= 64) {
      if ('id' in message) send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Too many pending requests; retry later' } });
      continue;
    }
    const state = { controller: new AbortController(), cancelled: false, method: message.method };
    if ('id' in message) active.set(message.id, state);
    // Initialization is a barrier; reads can overlap and summary writes stay ordered.
    const isWrite = message.method === 'tools/call' && message.params?.name === 'save_classroom_analysis';
    const job = forward(message, state, Promise.all([initialization, ...(isWrite ? [writes] : [])]));
    if (message.method === 'initialize') initialization = job;
    if (isWrite) writes = job;
    jobs.add(job);
    void job.finally(() => { jobs.delete(job); if ('id' in message) active.delete(message.id); });
  }
  await Promise.all(jobs);
}
