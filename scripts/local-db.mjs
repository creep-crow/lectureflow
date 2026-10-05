import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { root, runtime, runNode, log } from './local-core.mjs';

export function inferLegacyMigrations(columns, indexes) {
  const required = {
    classrooms: ['id', 'owner', 'title', 'created_at', 'notes', 'revision'],
    segments: ['seq', 'id', 'classroom_id', 'owner', 'offset_ms', 'english', 'chinese'],
    analyses: ['id', 'classroom_id', 'owner', 'title', 'content', 'created_at'],
  };
  if (Object.values(columns).every(values => !values.length)) return [];
  const requiredIndexes = ['idx_analyses_classroom_created', 'idx_classrooms_owner_created', 'segments_id_unique', 'idx_segments_classroom_seq'];
  if (Object.entries(required).some(([table, values]) => values.some(value => !columns[table]?.includes(value))) || requiredIndexes.some(value => !indexes.includes(value))) {
    throw new Error('现有数据库结构不完整，已停止更新。请备份 .wrangler/state，勿删除课堂数据。');
  }
  return ['0000_rapid_vulture.sql',
    ...(columns.segments.includes('translation_group') ? ['0001_colorful_changeling.sql'] : []),
    ...(columns.classrooms.includes('deleted_at') ? ['0002_confused_shadowcat.sql'] : []),
  ];
}

export async function prepareDatabase() {
  const backendDir = path.join(runtime, 'backend');
  await mkdir(backendDir, { recursive: true });
  const config = JSON.parse(await readFile(path.join(root, 'dist/server/wrangler.json'), 'utf8'));
  const generatedDir = path.join(root, 'dist/server');
  config.main = path.resolve(generatedDir, config.main);
  if (config.assets?.directory) config.assets.directory = path.resolve(generatedDir, config.assets.directory);
  config.d1_databases = config.d1_databases.map(binding => ({ ...binding, migrations_dir: path.join(root, 'drizzle') }));
  if (!config.d1_databases.some(binding => binding.binding === 'DB')) throw new Error('构建产物缺少本地数据库 DB。');
  const configPath = path.join(backendDir, 'wrangler.json');
  await writeFile(configPath, JSON.stringify(config, null, 2));
  // Wrangler reads these as hidden local secrets. Keep the original .env intact.
  const env = await readFile(path.join(root, '.env'), 'utf8').then(parseEnv).catch(error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
  const lines = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY'].filter(name => env[name]).map(name => `${name}=${JSON.stringify(env[name])}`);
  await writeFile(path.join(backendDir, '.dev.vars'), lines.join('\n') + '\n', { mode: 0o600 });
  const wranglerArgs = ['--import', pathToFileURL(path.join(root, 'scripts/sites-env.mjs')).href, path.join(root, 'node_modules/wrangler/bin/wrangler.js')];
  const common = ['DB', '--local', '--config', configPath, '--persist-to', path.join(root, '.wrangler/state')];
  const execute = (sql) => JSON.parse(runNode([...wranglerArgs, 'd1', 'execute', ...common, '--command', sql, '--json'], { capture: true, env: { CI: '1' } }));
  const columns = {};
  for (const table of ['classrooms', 'segments', 'analyses']) columns[table] = execute(`PRAGMA table_info(${table})`)[0].results.map(row => row.name);
  const indexes = execute("SELECT name FROM sqlite_master WHERE type='index'")[0].results.map(row => row.name);
  const legacy = inferLegacyMigrations(columns, indexes);
  execute('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
  const applied = execute('SELECT name FROM d1_migrations')[0].results.map(row => row.name);
  const journal = JSON.parse(await readFile(path.join(root, 'drizzle/meta/_journal.json'), 'utf8'));
  const pending = journal.entries.map(entry => entry.tag + '.sql').filter(name => !applied.includes(name));
  if (pending.length && legacy.length) {
    const backupDir = path.join(runtime, 'backups');
    await mkdir(backupDir, { recursive: true });
    const backup = path.join(backupDir, `classrooms-${Date.now()}.sql`);
    runNode([...wranglerArgs, 'd1', 'export', ...common, '--output', backup], { capture: true, env: { CI: '1' } });
    log('升级前已备份本地数据库：' + path.relative(root, backup));
  }
  for (const name of legacy.filter(name => !applied.includes(name))) execute(`INSERT OR IGNORE INTO d1_migrations(name) VALUES ('${name}')`);
  log('检查并应用尚未完成的本地数据库迁移。');
  runNode([...wranglerArgs, 'd1', 'migrations', 'apply', ...common], { capture: true, env: { CI: '1' } });
  log('本地数据库已就绪，已有课堂已保留。');
  return { configPath, wranglerArgs };
}
