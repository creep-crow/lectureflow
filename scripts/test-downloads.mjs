import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, runtime } from './local-core.mjs';
import { npmInstallOptions } from './download-sources.mjs';

// Explicit network test, separate from npm test. Uses disposable files, no model keys.
if (process.platform !== 'win32') throw new Error('The fresh PowerShell bootstrap check requires Windows.');
await mkdir(runtime, { recursive: true });
const fixture = await mkdtemp(path.join(runtime, 'test-downloads-'));
try {
  await mkdir(path.join(fixture, 'scripts'));
  await copyFile(path.join(root, 'scripts/bootstrap.ps1'), path.join(fixture, 'scripts/bootstrap.ps1'));
  const settings = (await readFile(path.join(root, 'scripts/download-sources.conf'), 'utf8'))
    .replace('NODE_MIRROR=https://registry.npmmirror.com/-/binary/node', 'NODE_MIRROR=https://registry.npmmirror.com/-/binary/node/intentionally-missing');
  await writeFile(path.join(fixture, 'scripts/download-sources.conf'), settings);
  await writeFile(path.join(fixture, 'scripts/local.mjs'), 'console.log("BOOTSTRAP_OK " + process.version);\n');
  const system = process.env.SystemRoot || 'C:\\Windows';
  const shell = path.join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  console.log('Checking real fallback Node.js download and SHA256 verification in a disposable directory...');
  const downloaded = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(fixture, 'scripts/bootstrap.ps1')], {
    env: { ...process.env, PATH: [system, path.join(system, 'System32'), path.join(system, 'System32/WindowsPowerShell/v1.0')].join(';'), LECTUREFLOW_NODE_MIRROR: '' },
    encoding: 'utf8', windowsHide: true, timeout: 360000,
  });
  assert.equal(downloaded.status, 0, downloaded.stderr);
  assert.match(downloaded.stdout, /BOOTSTRAP_OK v24\./);
  assert.match(downloaded.stderr, /trying the next source/);
  assert.match(downloaded.stderr, /repo\.huaweicloud\.com/);
  console.log('PASS fresh Node.js installation: failed primary, domestic backup, checksum and execution');

  const locked = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8')).packages['node_modules/clsx'];
  const packageData = { name: 'mirror-download-fixture', version: '1.0.0', dependencies: { clsx: locked.version } };
  const tinyLock = { name: packageData.name, version: '1.0.0', lockfileVersion: 3, packages: { '': packageData, 'node_modules/clsx': locked } };
  const lockText = JSON.stringify(tinyLock);
  await writeFile(path.join(fixture, 'package.json'), JSON.stringify(packageData));
  await writeFile(path.join(fixture, 'package-lock.json'), lockText);
  const npm = process.env.LECTUREFLOW_NPM_CLI || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const options = npmInstallOptions({}).map(option => option.startsWith('--cache=') ? '--cache=' + path.join(fixture, 'npm-cache') : option);
  const installed = spawnSync(process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=http', ...options], { cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stderr, /https:\/\/registry\.npmmirror\.com\/clsx\/-\/clsx-/);
  assert.equal(await readFile(path.join(fixture, 'package-lock.json'), 'utf8'), lockText);
  assert.equal(JSON.parse(await readFile(path.join(fixture, 'node_modules/clsx/package.json'), 'utf8')).version, locked.version);
  console.log('PASS npm fetch uses npmmirror, validates pinned integrity, and preserves canonical lockfile');
} finally {
  assert.ok(path.resolve(fixture).startsWith(path.resolve(runtime) + path.sep) && path.basename(fixture).startsWith('test-downloads-'));
  await rm(fixture, { recursive: true, force: true });
}
