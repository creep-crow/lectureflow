import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, access, rm, symlink } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { runtime, root } from './local-core.mjs';
import { downloadSources, npmInstallOptions } from './download-sources.mjs';

test('local installs use domestic registry, project-only cache and locked integrity', () => {
  const options = npmInstallOptions({});
  assert.equal(options[0], '--registry=https://registry.npmmirror.com/');
  assert.ok(options.includes('--replace-registry-host=npmjs'));
  assert.ok(options.includes('--cache=' + path.join(runtime, 'npm-cache')));
  assert.equal(downloadSources.NODE_MIRROR, 'https://registry.npmmirror.com/-/binary/node');
  assert.equal(downloadSources.NODE_FALLBACK, 'https://repo.huaweicloud.com/nodejs');
});
test('registry override remains process-local and rejects credential-bearing or insecure URLs', () => {
  assert.equal(npmInstallOptions({ LECTUREFLOW_NPM_REGISTRY: 'https://repo.huaweicloud.com/repository/npm/' })[0], '--registry=https://repo.huaweicloud.com/repository/npm/');
  for (const registry of ['http://example.com', 'https://user:password@example.com', 'https://example.com/?token=x']) {
    assert.throws(() => npmInstallOptions({ LECTUREFLOW_NPM_REGISTRY: registry }), /HTTPS/);
  }
});

async function fixture() {
  await mkdir(runtime, { recursive: true });
  const directory = await mkdtemp(path.join(runtime, 'test-uninstall-'));
  for (const folder of ['scripts', 'node_modules', 'dist', '.sites-runtime/toolchain', '.sites-runtime/npm-cache', '.sites-runtime/backups', '.wrangler/state', 'app']) await mkdir(path.join(directory, folder), { recursive: true });
  for (const file of ['uninstall.ps1', 'uninstall.sh', 'uninstall-targets.txt']) await copyFile(path.join(root, 'scripts', file), path.join(directory, 'scripts', file));
  await writeFile(path.join(directory, 'scripts/local.mjs'), '// fixture marker\n');
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'lectureflow' }));
  const kept = ['.env', '.wrangler/state/classrooms.sqlite', '.sites-runtime/backups/backup.sql', '.sites-runtime/local-preferences.json', 'app/source.ts'];
  const removed = ['node_modules/library.txt', 'dist/build.js', '.sites-runtime/toolchain/node.txt', '.sites-runtime/npm-cache/cache.txt'];
  for (const file of [...kept, ...removed]) await writeFile(path.join(directory, file), file === '.sites-runtime/local-preferences.json' ? '{"port":5199}' : 'fixture:' + file);
  return { directory, kept, removed };
}
async function cleanup(directory) {
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(path.resolve(runtime) + path.sep) && path.basename(resolved).startsWith('test-uninstall-'));
  await rm(resolved, { recursive: true, force: true });
}
const windows = process.platform === 'win32';
function uninstall(directory, preview = false) {
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(directory, 'scripts/uninstall.ps1'), ...(preview ? ['-DryRun'] : [])], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
}

test('Windows uninstall preserves classrooms, credentials, backups, source and settings; repeat is safe', { skip: !windows }, async () => {
  const data = await fixture();
  try {
    const preview = uninstall(data.directory, true);
    assert.equal(preview.status, 0, preview.stderr);
    for (const file of data.removed) await access(path.join(data.directory, file));
    const removed = uninstall(data.directory);
    assert.equal(removed.status, 0, removed.stderr);
    for (const file of data.removed) await assert.rejects(access(path.join(data.directory, file)), { code: 'ENOENT' });
    for (const file of data.kept) assert.equal(await readFile(path.join(data.directory, file), 'utf8'), file === '.sites-runtime/local-preferences.json' ? '{"port":5199}' : 'fixture:' + file);
    assert.equal(uninstall(data.directory).status, 0);
  } finally { await cleanup(data.directory); }
});
test('Windows uninstall removes a nested junction without deleting its external target', { skip: !windows }, async () => {
  const data = await fixture(), outside = await fixture();
  try {
    await symlink(outside.directory, path.join(data.directory, 'node_modules/linked'), 'junction');
    await symlink(path.join(outside.directory, 'missing-target'), path.join(data.directory, 'node_modules/broken-link'), 'junction');
    const result = uninstall(data.directory);
    assert.equal(result.status, 0, result.stderr);
    await access(path.join(outside.directory, 'node_modules/library.txt'));
    assert.equal(await readFile(path.join(outside.directory, '.env'), 'utf8'), 'fixture:.env');
  } finally { await cleanup(data.directory); await cleanup(outside.directory); }
});
test('Windows uninstall rejects linked parent folders before removing any dependencies', { skip: !windows }, async () => {
  const data = await fixture(), outside = await fixture();
  try {
    const runtimePath = path.join(data.directory, '.sites-runtime');
    assert.ok(runtimePath.startsWith(path.resolve(runtime) + path.sep));
    await rm(runtimePath, { recursive: true });
    await symlink(path.join(outside.directory, '.sites-runtime'), runtimePath, 'junction');
    const result = uninstall(data.directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /parent folder is a link/);
    await access(path.join(data.directory, 'node_modules/library.txt'));
    await access(path.join(outside.directory, '.sites-runtime/toolchain/node.txt'));
  } finally { await cleanup(data.directory); await cleanup(outside.directory); }
});
test('Windows uninstall refuses a live MCP or setup lease without killing the process or deleting files', { skip: !windows }, async () => {
  const data = await fixture();
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  try {
    await mkdir(path.join(data.directory, '.sites-runtime/processes'));
    await writeFile(path.join(data.directory, '.sites-runtime/processes/active.json'), JSON.stringify({ pid: child.pid, startedAt: Date.now(), root: data.directory }));
    const result = uninstall(data.directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /MCP clients/);
    assert.equal(child.exitCode, null);
    await access(path.join(data.directory, 'node_modules/library.txt'));
  } finally { child.kill(); await cleanup(data.directory); }
});
