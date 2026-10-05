import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, open, readFile, rm, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { root, runtime, log, validatePort, runNode, buildFingerprint, probeLocal, wait } from './local-core.mjs';
import { prepareDatabase } from './local-db.mjs';
import { startLocalServer } from './local-server.mjs';
import { runStdioBridge } from './mcp-stdio.mjs';
import { generateMcpConfig, mcpClients } from './mcp-config.mjs';

const { values } = parseArgs({ options: { mcp: { type: 'boolean' }, 'read-only': { type: 'boolean' }, 'mcp-config': { type: 'string' }, 'export-mcp-configs': { type: 'boolean' }, 'prepare-only': { type: 'boolean' }, repair: { type: 'boolean' }, 'no-open': { type: 'boolean' }, port: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help) {
  log('start.cmd / bash start.sh [--port 5173] [--no-open] [--prepare-only] [--repair]\nmcp.cmd / bash start.sh --mcp [--read-only]：本地 stdio MCP。\n--mcp-config generic|codex|claude-desktop|claude-code|cursor|vscode：输出接入配置\n--export-mcp-configs：导出全部客户端配置至 .sites-runtime/mcp-configs。');
  process.exit(0);
}
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || major === 22 && minor < 13) throw new Error('请使用 start.cmd / bash start.sh 自动补齐 Node.js。');
await mkdir(runtime, { recursive: true });
const preferencesPath = path.join(runtime, 'local-preferences.json');
let preferences = {};
try { preferences = JSON.parse(await readFile(preferencesPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const port = validatePort(values.port || preferences.port || 5173);
if (values['mcp-config'] || values['export-mcp-configs']) {
  const options = { executable: process.execPath, directory: root, port, readOnly: !!values['read-only'] };
  if (values['export-mcp-configs']) {
    const directory = path.join(runtime, 'mcp-configs');
    await mkdir(directory, { recursive: true });
    for (const client of Object.keys(mcpClients)) {
      const generated = generateMcpConfig({ ...options, client });
      await writeFile(path.join(directory, generated.filename), generated.content);
    }
    log('已导出全部客户端配置：' + directory + '\n将 lectureflow 条目合并到客户端配置，保留其他服务。首次接入前请先完成网页启动。');
  }
  if (values['mcp-config']) process.stdout.write(generateMcpConfig({ ...options, client: values['mcp-config'] }).content);
  process.exit(0);
}
const origin = `http://127.0.0.1:${port}`;
let ownedServer;
let lockHandle;
const lockPath = path.join(runtime, 'local-setup.lock');
const cleanup = async () => {
  if (ownedServer) { await ownedServer.close(); ownedServer = undefined; }
  if (lockHandle) { await lockHandle.close(); lockHandle = undefined; await rm(lockPath, { force: true }); }
};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(0)); });
const openBrowser = () => {
  if (values['no-open'] || values.mcp || values['prepare-only']) return;
  const url = origin + '/signin-with-chatgpt?return_to=/';
  if (process.platform === 'win32') spawnSync('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' });
  else spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
};
try {
  if (!await probeLocal(port)) {
    // A filesystem lock prevents npm/build/migrations from racing across desktop clients.
    for (let i = 0; i < 600 && !lockHandle; i++) {
      try {
        lockHandle = await open(lockPath, 'wx');
        await lockHandle.writeFile(JSON.stringify({ pid: process.pid }));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let active = true;
        try { const owner = JSON.parse(await readFile(lockPath, 'utf8')); process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') active = false; }
        if (!active) { await rm(lockPath, { force: true }); continue; }
        if (await probeLocal(port)) break;
        if (i === 0) log('正在等待另一个启动窗口完成准备……');
        await wait(1000);
      }
    }
    if (!lockHandle && !await probeLocal(port)) throw new Error('等待启动超时。关闭其他启动窗口后重试。');
    if (lockHandle && !await probeLocal(port)) {
      const npmCli = process.env.LECTUREFLOW_NPM_CLI || process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
      const dependencyHash = createHash('sha256').update(await readFile(path.join(root, 'package-lock.json'))).update(await readFile(path.join(root, 'package.json'))).update(`${major}:${process.platform}:${process.arch}`).digest('hex');
      const stampPath = path.join(runtime, 'dependencies.json');
      let stamp;
      try { stamp = JSON.parse(await readFile(stampPath, 'utf8')); } catch {}
      const dependencyPaths = ['vinext/dist/cli.js', 'wrangler/bin/wrangler.js', 'typescript/bin/tsc', '@cloudflare/vite-plugin/package.json', 'miniflare/package.json'];
      let complete = stamp?.hash === dependencyHash;
      for (const dependency of dependencyPaths) try { await access(path.join(root, 'node_modules', dependency)); } catch { complete = false; }
      if (complete) {
        const check = spawnSync(process.execPath, [npmCli, 'ls', '--depth=0', '--omit=optional', '--json'], { cwd: root, windowsHide: true, stdio: 'pipe' });
        complete = check.status === 0;
      }
      if (!complete || values.repair) {
        await access(npmCli).catch(() => { throw new Error('npm 不可用，请通过 start.cmd / bash start.sh 启动。'); });
        log('正在安装或修复锁定版本的依赖，首次运行需要联网。');
        runNode([npmCli, 'ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund'], { env: { SHARP_IGNORE_GLOBAL_LIBVIPS: '1' } });
        await writeFile(stampPath, JSON.stringify({ hash: dependencyHash }));
      } else log('依赖已就绪。');
      try { await copyFile(path.join(root, '.env.example'), path.join(root, '.env'), 1); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const fingerprint = await buildFingerprint();
      const buildStampPath = path.join(runtime, 'local-build.json');
      let buildStamp;
      try { buildStamp = JSON.parse(await readFile(buildStampPath, 'utf8')); } catch {}
      let built = buildStamp?.hash === fingerprint;
      for (const file of ['dist/server/index.js', 'dist/server/wrangler.json', 'dist/client']) try { await access(path.join(root, file)); } catch { built = false; }
      if (!built || values.repair) {
        log('正在构建本地课堂……');
        runNode([path.join(root, 'node_modules/vinext/dist/cli.js'), 'build']);
        runNode([path.join(root, 'scripts/verify-release.mjs')]);
        await writeFile(buildStampPath, JSON.stringify({ hash: fingerprint }));
      } else log('使用已完成的本地构建。');
      const database = await prepareDatabase();
      await writeFile(preferencesPath, JSON.stringify({ port }));
      if (!values['prepare-only']) ownedServer = await startLocalServer(port, database);
    }
    if (lockHandle) { await lockHandle.close(); lockHandle = undefined; await rm(lockPath, { force: true }); }
  } else log('复用已运行的本地课堂。');
  if (values['prepare-only']) { log('依赖、构建和本地数据库已准备完成。'); await cleanup(); }
  else if (values.mcp) { await runStdioBridge(origin, { readOnly: !!values['read-only'] }); await cleanup(); }
  else {
    log(`课堂已就绪：${origin}` + (ownedServer
      ? '\n请保留此窗口；按 Ctrl+C 可停止本次启动的服务。'
      : '\n后台由原启动窗口继续运行，本次无需保留新窗口。'));
    openBrowser();
    if (ownedServer) await new Promise((resolve, reject) => { ownedServer.backend.once('exit', code => code ? reject(new Error('本地后台已停止，请重新启动。')) : resolve()); });
  }
} catch (error) {
  await cleanup();
  log(error.code === 'EADDRINUSE' ? `端口 ${port} 已被其他程序占用。关闭该程序，或使用 start.cmd --port 5180。` : error.message);
  process.exitCode = 1;
}
