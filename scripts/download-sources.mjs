import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runtime } from './local-core.mjs';

export const downloadSources = Object.fromEntries(readFileSync(new URL('./download-sources.conf', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split('=')));

export function npmInstallOptions(env = process.env) {
  const registry = new URL(env.LECTUREFLOW_NPM_REGISTRY || downloadSources.NPM_REGISTRY);
  if (registry.protocol !== 'https:' || registry.username || registry.password || registry.search || registry.hash) {
    throw new Error('LECTUREFLOW_NPM_REGISTRY 必须是无账号密码和查询参数的 HTTPS 网址。');
  }
  return [`--registry=${registry.href}`, '--replace-registry-host=npmjs', `--cache=${path.join(runtime, 'npm-cache')}`,
    '--fetch-retries=2', '--fetch-timeout=60000'];
}
