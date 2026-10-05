import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { root } from './local-core.mjs';

const [configPath, port] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const variables = await readFile(path.join(root, '.env'), 'utf8').then(parseEnv).catch(error => {
  if (error.code === 'ENOENT') return {};
  throw error;
});
const bindings = { ...config.vars };
for (const name of ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY']) if (variables[name]) bindings[name] = variables[name];
const modules = [{ type: 'ESModule', path: config.main }];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (/\.(m?js)$/.test(entry.name) && file !== config.main) modules.push({ type: 'ESModule', path: file });
  }
}
await collect(path.dirname(config.main));
// A fixed runtime has no development watcher or implicit reloads during POST requests.
const worker = new Miniflare({
  rootPath: root, host: '127.0.0.1', port: Number(port), cf: false,
  modules,
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings,
  d1Databases: Object.fromEntries(config.d1_databases.map(binding => [binding.binding, binding.database_id])),
  defaultPersistRoot: path.join(root, '.wrangler/state/v3'),
  d1Persist: path.join(root, '.wrangler/state/v3/d1'),
  ...(config.assets?.directory ? { assets: { directory: config.assets.directory, routerConfig: { has_user_worker: true } } } : {}),
  log: new Log(LogLevel.ERROR), logRequests: false, telemetry: { enabled: false },
  handleRuntimeStdio(stdout, stderr) { stdout.pipe(process.stderr, { end: false }); stderr.pipe(process.stderr, { end: false }); },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void worker.dispose().finally(() => process.exit(0)); });
await worker.ready;
