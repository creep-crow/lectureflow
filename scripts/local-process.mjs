import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { root, runtime } from './local-core.mjs';

export async function trackLocalProcess() {
  const directory = path.join(runtime, 'processes');
  await mkdir(directory, { recursive: true });
  const lease = path.join(directory, process.pid + '.json');
  await writeFile(lease, JSON.stringify({ pid: process.pid, root: path.resolve(root), startedAt: Math.round(Date.now() - process.uptime() * 1000) }));
  return () => rm(lease, { force: true });
}
