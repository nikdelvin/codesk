import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocket } from 'ws';
import { root, settings, settingsPath, writeJson } from './project.mjs';

const config = settings();
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Run the tunnel probe with normal TLS verification enabled.');
const client = new Client({ name: 'codesk-local-smoke', version: '1' });
const transport = new StdioClientTransport({ command: config.nodePath,
  args: [join(root, 'dist/stdio.mjs'), settingsPath], stderr: 'pipe' });
let runId, socket;
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.find(tool => tool.name === 'open_plugin')._meta.ui.resourceUri);
  const opened = await client.callTool({ name: 'open_plugin', arguments: {} }, undefined, { timeout: 47000 });
  assert.ok(!opened.isError, opened.content?.[0]?.text);
  const bootstrap = opened._meta['codesk/bootstrap']; runId = bootstrap.runId;
  const uri = opened._meta.ui.resourceUri;
  const view = await client.readResource({ uri });
  const origin = new URL(bootstrap.socketUrl).origin.replace('wss:', 'https:');
  assert.deepEqual(view.contents[0]._meta.ui.csp.connectDomains, [origin, origin.replace('https:', 'wss:')]);
  assert.deepEqual(view.contents[0]._meta.ui.csp.resourceDomains, [origin]);
  const assets = JSON.parse(readFileSync(join(root, 'dist/ui-assets.json'), 'utf8'));
  for (const [path, info] of Object.entries(assets)) {
    assert.ok(view.contents[0].text.includes(`${origin}/${path}`));
    const response = await fetch(`${origin}/${path}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), info.sha256);
    assert.equal(bytes.length, info.bytes);
  }
  const video = Object.keys(assets).find(path => path.endsWith('.mp4'));
  const range = await fetch(`${origin}/${video}`, { headers: { Range: 'bytes=0-31' }, signal: AbortSignal.timeout(10000) });
  assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 32);
  const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  assert.equal(health.status, 200);
  socket = new WebSocket(bootstrap.socketUrl, ['codesk.local.ws', `cap.${bootstrap.capability}`], { handshakeTimeout: 10000 });
  const frames = [];
  socket.on('message', data => { if (data.toString() !== 'pong') frames.push(JSON.parse(data.toString())); });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  async function received(value, revision) {
    const deadline = Date.now() + 10000;
    while (!frames.some(frame => frame.value === value && frame.revision === revision)) {
      if (Date.now() > deadline) throw new Error(`WSS did not deliver value ${value}, revision ${revision}.`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  await received(0, 0);
  for (const [index, value] of [5, 12, 3].entries()) {
    const result = await client.callTool({ name: 'set_state', arguments: { run_id: runId, value, operation_id: randomUUID() } });
    assert.ok(!result.isError, result.content?.[0]?.text);
    await received(value, index + 1);
  }
  const result = { checkedAt: new Date().toISOString(), plugin: config.pluginName, https: true, wss: true, assets: 4, videoRange: true,
    revisions: frames.filter(frame => frame.type === 'state').map(({ value, revision }) => ({ value, revision })),
    normalCertificateVerification: true, nativeCodexAcceptance: 'not established by this probe' };
  writeJson(join(root, '.local/tunnel-evidence.json'), result);
  console.log(JSON.stringify(result, null, 2));
} finally {
  socket?.terminate();
  if (runId) await client.callTool({ name: 'delete_run', arguments: { run_id: runId } }).catch(() => {});
  await client.close();
}
