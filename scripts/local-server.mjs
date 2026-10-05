import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { root, instance, startNode, stopChild, wait } from './local-core.mjs';
import path from 'node:path';
import { generateMcpConfig } from './mcp-config.mjs';

export function safeReturn(value) {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const url = new URL(value, 'http://localhost');
    if (url.origin !== 'http://localhost' || ['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback'].includes(url.pathname)) return '/';
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}
export function allowedLocalRequest(request, port) {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowed.has(request.headers.host) || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) return false;
  if (request.headers.origin && ![...allowed].some(host => request.headers.origin === 'http://' + host)) return false;
  return request.headers['sec-fetch-site'] !== 'cross-site';
}
const cookieName = '__lectureflow_local';
function authenticated(headers, secret) {
  const values = String(headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(cookieName + '='));
  if (values.length !== 1) return false;
  const token = Buffer.from(values[0].slice(cookieName.length + 1));
  const expected = Buffer.from(secret);
  return token.length === expected.length && timingSafeEqual(token, expected);
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export async function startLocalServer(port, { configPath }) {
  const secret = randomBytes(32).toString('hex');
  const backendPort = await freePort();
  const backendOrigin = `http://127.0.0.1:${backendPort}`;
  let ready = false;
  const json = (response, status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(data));
  };
  const server = http.createServer((request, response) => {
    if (!allowedLocalRequest(request, port)) { json(response, 403, { error: '仅允许来自本机课堂的请求。' }); return; }
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/api/health') {
      json(response, ready ? 200 : 503, { application: 'lectureflow', mode: 'local', version: '1.2.1', instance, ready });
      return;
    }
    if (!ready) { json(response, 503, { error: '本地课堂正在启动，请稍后重试。' }); return; }
    if (['/signin-with-chatgpt', '/signout-with-chatgpt'].includes(url.pathname)) {
      if (request.method !== 'GET' && !(url.pathname === '/signout-with-chatgpt' && request.method === 'POST')) { response.writeHead(405); response.end(); return; }
      const signOut = url.pathname === '/signout-with-chatgpt';
      response.writeHead(302, { Location: safeReturn(url.searchParams.get('return_to')), 'Cache-Control': 'no-store',
        'Set-Cookie': `${cookieName}=${signOut ? '' : secret}; Path=/; HttpOnly; SameSite=Strict${signOut ? '; Max-Age=0' : ''}` });
      response.end(); return;
    }
    if (!authenticated(request.headers, secret)) {
      if (url.pathname.startsWith('/api/') || url.pathname === '/mcp') json(response, 401, { error: '请先打开本地课堂。' });
      else { response.writeHead(302, { Location: '/signin-with-chatgpt?return_to=' + encodeURIComponent(url.pathname + url.search) }); response.end(); }
      return;
    }
    if (url.pathname === '/api/local/mcp-config') {
      try {
        const generated = generateMcpConfig({ client: url.searchParams.get('client') || 'generic', executable: process.execPath, directory: root, port, readOnly: url.searchParams.get('readOnly') === '1' });
        json(response, 200, url.searchParams.has('client') ? generated : generated.config);
      } catch { json(response, 400, { error: '不支持的 MCP 客户端。' }); }
      return;
    }
    const headers = { ...request.headers, host: `127.0.0.1:${backendPort}` };
    for (const name of Object.keys(headers)) if (name.startsWith('oai-authenticated-user-') || name.startsWith('x-forwarded-')) delete headers[name];
    headers['oai-authenticated-user-id'] = 'local_seedy'; // Preserve classrooms from earlier local versions.
    headers['oai-authenticated-user-email'] = 'local@lectureflow.local';
    headers['oai-authenticated-user-full-name'] = encodeURIComponent('本地课堂');
    headers['oai-authenticated-user-full-name-encoding'] = 'percent-encoded-utf-8';
    if (headers.origin) headers.origin = backendOrigin;
    const cookies = String(headers.cookie || '').split(';').map(value => value.trim()).filter(value => !value.startsWith(cookieName + '='));
    if (cookies.length) headers.cookie = cookies.join('; '); else delete headers.cookie;
    // workerd may close an idle keep-alive socket just as Node reuses it.
    // A fresh loopback connection avoids ECONNRESET without retrying a write.
    const upstream = http.request(backendOrigin + url.pathname + url.search, { method: request.method, headers, agent: false }, incoming => {
      const outgoingHeaders = { ...incoming.headers };
      if (outgoingHeaders.location?.startsWith(backendOrigin)) outgoingHeaders.location = outgoingHeaders.location.slice(backendOrigin.length) || '/';
      response.writeHead(incoming.statusCode || 502, outgoingHeaders);
      incoming.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) json(response, 502, { error: '本地后台未响应，请重新启动课堂。' }); else response.destroy(); });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => { if (!response.writableEnded) upstream.destroy(); });
    request.pipe(upstream);
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const backend = startNode([path.join(root, 'scripts/local-worker.mjs'), configPath, String(backendPort)]);
  backend.stdout.pipe(process.stderr, { end: false });
  backend.stderr.pipe(process.stderr, { end: false });
  let backendError;
  backend.once('error', error => { backendError = error; });
  const close = async () => {
    ready = false;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    stopChild(backend);
  };
  try {
    for (let i = 0; i < 120; i++) {
      if (backendError) throw backendError;
      if (backend.exitCode !== null) throw new Error('本地后台启动失败，请查看上方日志。');
      try {
        const result = await fetch(backendOrigin + '/api/health', { signal: AbortSignal.timeout(1000) });
        if (result.ok && (await result.json()).application === 'lectureflow') { ready = true; break; }
      } catch {}
      await wait(500);
    }
    if (!ready) throw new Error('后台启动超过 60 秒，请查看日志并重试。');
    backend.once('exit', () => { ready = false; server.close(); });
    return { close, backend, server };
  } catch (error) { await close(); throw error; }
}
