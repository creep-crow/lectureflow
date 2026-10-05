import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const runtime = path.join(root, '.sites-runtime');
export const instance = createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 24);
export const log = (message) => process.stderr.write(`[LectureFlow] ${message}\n`);
export function validatePort(value) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1024 || Number(value) > 65535) throw new Error('端口必须是 1024–65535 之间的整数。');
  return Number(value);
}
export function runNode(args, { capture = false, env = {} } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root, env: { ...process.env, ...env }, windowsHide: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', process.stderr, process.stderr],
    encoding: 'utf8', maxBuffer: 20_000_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(capture ? `本地命令失败：${result.stderr || result.stdout}` : '操作失败，请查看上方错误信息。');
  return result.stdout;
}
export function startNode(args) {
  return spawn(process.execPath, args, { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}
export function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else child.kill('SIGTERM');
}
export async function buildFingerprint() {
  const hash = createHash('sha256').update(process.versions.node + process.platform + process.arch);
  async function add(relative) {
    const full = path.join(root, relative);
    let entries;
    try { entries = await readdir(full, { withFileTypes: true }); } catch (error) {
      if (error.code !== 'ENOTDIR') throw error;
      hash.update(relative).update(await readFile(full));
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('构建目录不能包含符号链接：' + relative);
      await add(path.join(relative, entry.name));
    }
  }
  for (const name of ['app', 'components', 'hooks', 'lib', 'build', 'public', 'vendor', 'vite.config.ts', 'next.config.ts', 'postcss.config.mjs', 'tsconfig.json', 'package.json', 'package-lock.json', '.openai/hosting.json']) await add(name);
  return hash.digest('hex');
}
export async function probeLocal(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    const data = await response.json();
    return response.ok && data.application === 'lectureflow' && data.mode === 'local' && data.instance === instance;
  } catch { return false; }
}
export const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
