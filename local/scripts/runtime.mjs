import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { readJson, root, settings, settingsPath } from './project.mjs';
import { inspectRuntime, request, connectRuntime } from '../dist/library.mjs';

const action = process.argv[2] ?? 'status';
if (!['status', 'stop', 'restart', 'diagnostics'].includes(action)) throw new Error('Use status, stop, restart, or diagnostics.');
const config = settings();
const current = await inspectRuntime(config);
if (action === 'stop' || action === 'restart') {
  if (current) {
    await request(current.descriptor, 'stop');
    const deadline = Date.now() + 10000;
    while (await inspectRuntime(config)) {
      if (Date.now() > deadline) throw new Error('Runtime shutdown timed out. Run diagnostics; no process was forcibly killed.');
      await delay(100);
    }
  }
  if (action === 'stop') console.log('Local runtime stopped. Saved runs are preserved.');
  else {
    const client = await connectRuntime(settingsPath);
    try { console.log(JSON.stringify(await client.call('ready'), null, 2)); }
    finally { await client.close(); }
    console.log('Runtime restarted. Resume a saved run in a fresh Codex task.');
  }
} else {
  console.log(JSON.stringify({ plugin: config.pluginName, dataDir: config.dataDir,
    buildHash: readJson(join(root, 'dist/build.json')).buildHash, runtime: current?.status ?? { phase: 'stopped' },
    ...(action === 'diagnostics' ? { node: process.version, cloudflaredPath: config.cloudflaredPath,
      note: 'Status is sanitized. Runtime logs are kept beside SQLite; bootstrap capabilities and control tokens are not logged.' } : {}),
  }, null, 2));
}
