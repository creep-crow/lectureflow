import { createInterface } from 'node:readline';

export async function runStdioBridge(origin, { input = process.stdin, output = process.stdout, fetchImpl = fetch } = {}) {
  const target = new URL(origin);
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') throw new Error('本地 MCP 只连接 127.0.0.1。');
  const sign = await fetchImpl(origin + '/signin-with-chatgpt?return_to=/', { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  const cookie = sign.headers.get('set-cookie')?.split(';')[0];
  if (sign.status !== 302 || !cookie) throw new Error('无法连接本地课堂，请先运行 start.cmd。');
  const lines = createInterface({ input, crlfDelay: Infinity });
  let protocol = '2025-06-18';
  // Sequential forwarding preserves initialization and append ordering; no logs enter stdout.
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    const send = (data) => output.write(JSON.stringify(data) + '\n');
    try { message = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      // Responses to server requests are not used by this server.
      if (message?.jsonrpc === '2.0' && ('result' in message || 'error' in message) && !('method' in message)) continue;
      send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }); continue;
    }
    if (Buffer.byteLength(line) > 200000) {
      if ('id' in message) send({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Request too large' } });
      continue;
    }
    try {
      const response = await fetchImpl(origin + '/mcp', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Cookie: cookie, Origin: origin, 'MCP-Protocol-Version': protocol },
        body: JSON.stringify(message), signal: AbortSignal.timeout(30000), redirect: 'error',
      });
      if (!('id' in message)) continue;
      const data = await response.json();
      if (data.jsonrpc !== '2.0' || data.id !== message.id || (!('result' in data) && !('error' in data))) throw new Error('Invalid backend response');
      if (message.method === 'initialize' && data.result?.protocolVersion) protocol = data.result.protocolVersion;
      send(data);
    } catch {
      if ('id' in message) send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Local classroom unavailable. Restart LectureFlow and reconnect.' } });
    }
  }
}
