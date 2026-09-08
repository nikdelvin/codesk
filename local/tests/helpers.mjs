import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocket } from 'ws';
import { atomicJson, startDaemon, connectRuntime } from '../dist/library.mjs';

export const root = resolve(import.meta.dirname, '..');
export function temporary(_t) {
  const path = mkdtempSync(join(tmpdir(), 'codesk-local-'));
  // Exit cleanup runs after each test's server/database teardown, even when
  // several tests share a process. Never unlink an active SQLite lock file.
  process.once('exit', () => rmSync(path, { recursive: true, force: true })); return path;
}
export async function eventually(check, timeout = 5000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await delay(25); }
  throw new Error('Condition did not become true within timeout.');
}
export function fakeTunnels() {
  const instances = [];
  const factory = () => {
    let exit;
    const exited = new Promise(resolve => { exit = resolve; });
    const tunnel = { origin: Promise.resolve(`https://fixture-${randomUUID()}.trycloudflare.com`), exited,
      close: async () => exit(), exit };
    instances.push(tunnel); return tunnel;
  };
  return { instances, factory };
}
export function configuration(directory) {
  return { pluginName: 'codesk-local', installationId: randomUUID(), dataDir: join(directory, 'data'),
    cloudflaredPath: process.execPath, nodePath: process.execPath };
}
export async function fixture(t, options = {}) {
  const directory = temporary(t), settings = configuration(directory), path = join(directory, 'settings.json');
  atomicJson(path, settings);
  const tunnels = fakeTunnels();
  const daemon = await startDaemon(settings, { tunnelFactory: tunnels.factory, probe: async () => {},
    retryDelays: [10, 10, 10], ...options });
  t.after(() => daemon.close());
  const client = await connectRuntime(path); t.after(() => client.close());
  await client.call('ready');
  return { ...daemon, directory, settings, settingsPath: path, tunnels, client };
}
export async function mcp(t, settingsPath, entry = join(root, 'dist/stdio.mjs'), cwd = tmpdir()) {
  const client = new Client({ name: 'local-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: settingsPath ? [entry, settingsPath] : [entry], cwd, stderr: 'pipe' });
  let stderr = '';
  await client.connect(transport);
  transport.stderr?.on('data', bytes => { stderr += bytes.toString(); });
  t.after(() => client.close());
  return { client, stderr: () => stderr, tool: (name, input = {}) => client.callTool({ name, arguments: input }) };
}
export async function socket(t, publicUrl, bootstrap) {
  const ws = new WebSocket(`${publicUrl.replace('http:', 'ws:')}/ws/${bootstrap.runId}`,
    ['codesk.local.ws', `cap.${bootstrap.capability}`]);
  const messages = [];
  ws.on('message', bytes => { if (bytes.toString() !== 'pong') messages.push(JSON.parse(bytes.toString())); });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  t.after(() => ws.terminate());
  return { ws, messages, received: (value, revision) => eventually(() => messages.some(frame => frame.value === value && frame.revision === revision)) };
}
