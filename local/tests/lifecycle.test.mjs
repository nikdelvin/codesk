import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { atomicJson, ensureRuntime, connectRuntime, inspectRuntime, request, startDaemon } from '../dist/library.mjs';
import { temporary, configuration, root, eventually, fakeTunnels } from './helpers.mjs';

test('simultaneous launchers elect one owner; restart recovers SQLite and operation receipts', async t => {
  const directory = temporary(t), config = configuration(directory), path = join(directory, 'settings.json');
  atomicJson(path, config);
  const options = { entryPath: join(root, 'tests/fixture-daemon.mjs') };
  t.after(async () => { const live = await inspectRuntime(config); if (live) await request(live.descriptor, 'stop'); });
  const launched = await Promise.all(Array.from({ length: 6 }, () => ensureRuntime(path, options)));
  assert.equal(new Set(launched.map(x => x.status.runtimeId)).size, 1);
  const first = await connectRuntime(path, options), second = await connectRuntime(path, options);
  await first.call('ready');
  const opened = await first.call('open');
  const change = { run_id: opened.run.run_id, value: 12, operation_id: 'durable' };
  const receipt = await second.call('set', change), before = first.status.runtimeId;
  await first.close(); assert.equal((await second.call('get', { run_id: change.run_id })).value, 12);
  await second.call('stop'); await second.close();
  await eventually(async () => !(await inspectRuntime(config)));
  const after = await connectRuntime(path, options); t.after(() => after.close());
  assert.notEqual(after.status.runtimeId, before);
  assert.equal((await after.call('get', { run_id: change.run_id })).value, 12);
  assert.deepEqual(await after.call('set', change), { ...receipt, duplicate: true });
  assert.equal((await after.call('list')).runs.length, 1);
});
test('stale metadata and an unlocked coordination file recover without trusting a PID', async t => {
  const directory = temporary(t), config = configuration(directory), path = join(directory, 'settings.json');
  mkdirSync(config.dataDir); atomicJson(path, config);
  atomicJson(join(config.dataDir, 'runtime.json'), { installationId: config.installationId,
    runtimeId: 'stale', pid: process.pid, controlUrl: 'http://127.0.0.1:1', token: 'invalid' });
  const { DatabaseSync } = await import('node:sqlite');
  const abandoned = new DatabaseSync(join(config.dataDir, 'runtime-lock.sqlite')); abandoned.close();
  const running = await connectRuntime(path, { entryPath: join(root, 'tests/fixture-daemon.mjs') });
  t.after(async () => { await running.call('stop').catch(() => {}); await running.close(); });
  assert.notEqual(running.status.pid, process.pid); assert.equal(running.status.installationId, config.installationId);
});
test('tunnel startup is bounded and stops after exactly three recovery attempts', async t => {
  const directory = temporary(t), config = configuration(directory), path = join(directory, 'settings.json'); atomicJson(path, config);
  let starts = 0;
  const daemon = await startDaemon(config, { tunnelFactory: () => {
    starts++; return { origin: Promise.resolve('https://unavailable.trycloudflare.com'),
      exited: Promise.resolve(), close: async () => {} };
  }, probe: async () => { throw new Error('offline'); }, retryDelays: [1, 1, 1], readyTimeoutMs: 100 });
  t.after(() => daemon.close());
  const client = await connectRuntime(path); t.after(() => client.close());
  await assert.rejects(client.call('ready'), { code: 'TUNNEL_UNAVAILABLE' });
  await eventually(() => daemon.status().phase === 'failed'); assert.equal(starts, 4);
  assert.equal((await client.call('list')).runs.length, 0);
});
test('a client disappearing without a clean detach does not hold the runtime alive', async t => {
  const directory = temporary(t), config = configuration(directory), path = join(directory, 'settings.json'); atomicJson(path, config);
  const daemon = await startDaemon(config, { tunnelFactory: fakeTunnels().factory, probe: async () => {}, idleGraceMs: 100, heartbeatMs: 50 });
  t.after(() => daemon.close());
  const client = await connectRuntime(path); client.ws.terminate();
  await eventually(async () => !(await inspectRuntime(config)));
});
test('watchdog reaps cloudflared after an abrupt daemon death', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const directory = temporary(t), config = configuration(directory), path = join(directory, 'settings.json');
  const binary = join(directory, 'fake-cloudflared'), pidPath = join(directory, 'tunnel.pid');
  writeFileSync(binary, `#!${process.execPath}\nconst fs = require('node:fs');fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));console.log('https://watchdog.trycloudflare.com');setInterval(() => {}, 1000);\n`, { mode: 0o700 });
  config.cloudflaredPath = binary; atomicJson(path, config);
  const child = spawn(process.execPath, [join(root, 'tests/fixture-daemon.mjs'), '--serve', path, '--real-watchdog'], { stdio: 'ignore' });
  t.after(() => child.kill('SIGTERM'));
  await eventually(() => inspectRuntime(config));
  const client = await connectRuntime(path); t.after(() => client.close()); await client.call('ready');
  const tunnelPid = Number(readFileSync(pidPath, 'utf8'));
  child.kill('SIGKILL');
  await eventually(() => { try { process.kill(tunnelPid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
  // The OS lock must also be released after SIGKILL; stale runtime.json is harmless.
  config.cloudflaredPath = process.execPath; atomicJson(path, config);
  const restarted = await connectRuntime(path, { entryPath: join(root, 'tests/fixture-daemon.mjs') });
  t.after(async () => { await restarted.call('stop').catch(() => {}); await restarted.close(); });
  assert.notEqual(restarted.status.pid, child.pid);
});
