import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { fixture, eventually, mcp, socket } from './helpers.mjs';
import { connectRuntime, inspectRuntime } from '../dist/library.mjs';

test('separate MCP processes share resources, runs, receipts and real WebSockets', async t => {
  const f = await fixture(t), a = await mcp(t, f.settingsPath), b = await mcp(t, f.settingsPath);
  const toolsA = await a.client.listTools(), toolsB = await b.client.listTools();
  assert.equal(toolsA.tools.length, 5);
  const uri = toolsA.tools.find(tool => tool.name === 'open_plugin')._meta.ui.resourceUri;
  assert.equal(toolsB.tools.find(tool => tool.name === 'open_plugin')._meta.ui.resourceUri, uri);
  const opened = await a.tool('open_plugin'), bootstrap = opened._meta['codesk/bootstrap'];
  const view = await b.client.readResource({ uri });
  const origin = new URL(bootstrap.socketUrl).origin;
  assert.deepEqual(view.contents[0]._meta.ui.csp.connectDomains, [origin.replace('wss:', 'https:'), origin]);
  assert.ok(view.contents[0].text.includes(bootstrap.generation));
  assert.ok(!JSON.stringify(opened.structuredContent).includes(bootstrap.capability));
  assert.ok(!opened.content[0].text.includes(bootstrap.capability));
  const ws = await socket(t, f.publicUrl, bootstrap); await ws.received(0, 0);
  for (const [index, value] of [5, 12, 3].entries()) {
    const result = await b.tool('set_state', { run_id: bootstrap.runId, value, operation_id: randomUUID() });
    assert.equal(result.structuredContent.revision, index + 1); await ws.received(value, index + 1);
  }
  const concurrent = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).tool('set_state',
    { run_id: bootstrap.runId, value: i, operation_id: `parallel_${i}` })));
  assert.deepEqual(concurrent.map(result => result.structuredContent.revision).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 4));
  assert.equal((await a.tool('get_state', { run_id: bootstrap.runId })).structuredContent.revision, 15);
  const resumed = await b.tool('open_plugin', { run_id: bootstrap.runId });
  assert.equal(resumed.structuredContent.revision, 15);
  await a.client.close(); assert.equal((await b.tool('get_state', { run_id: bootstrap.runId })).structuredContent.revision, 15);
  assert.ok(!a.stderr().includes(bootstrap.capability));
});
test('public routes expose no control or mutation API, and socket auth is mandatory', async t => {
  const f = await fixture(t), opened = await f.client.call('open'), bootstrap = opened.bootstrap;
  for (const path of ['/rpc', '/status', '/mcp', '/clients', '/state.sqlite', '/runtime.json', '/../state.sqlite']) {
    assert.equal((await fetch(`${f.publicUrl}${path}`)).status, 404);
    assert.equal((await fetch(`${f.publicUrl}${path}`, { method: 'POST', body: '{}' })).status, 404);
  }
  assert.equal((await fetch(`${f.controlUrl}/status`)).status, 401);
  for (const protocols of [[], ['codesk.local.ws', `cap.${'a'.repeat(43)}`]]) {
    const ws = new WebSocket(`${f.publicUrl.replace('http:', 'ws:')}/ws/${bootstrap.runId}`, protocols);
    await new Promise(resolve => ws.once('error', resolve));
  }
  const connected = await socket(t, f.publicUrl, bootstrap);
  connected.ws.send(JSON.stringify({ value: 888 }));
  await eventually(() => connected.ws.readyState === WebSocket.CLOSED);
  assert.equal((await f.client.call('get', { run_id: bootstrap.runId })).value, 0);
  const foreign = await f.client.call('open');
  const ws = new WebSocket(`${f.publicUrl.replace('http:', 'ws:')}/ws/${foreign.run.run_id}`,
    ['codesk.local.ws', `cap.${bootstrap.capability}`]);
  await new Promise(resolve => ws.once('error', resolve));
});
test('snapshot reconnect and deletion isolate independent runs', async t => {
  const f = await fixture(t), first = await f.client.call('open'), second = await f.client.call('open');
  const a = await socket(t, f.publicUrl, first.bootstrap), b = await socket(t, f.publicUrl, second.bootstrap);
  await a.received(0, 0); await b.received(0, 0); a.ws.terminate();
  await f.client.call('set', { run_id: first.run.run_id, value: 7, operation_id: 'offline' });
  const reconnected = await socket(t, f.publicUrl, first.bootstrap); await reconnected.received(7, 1);
  assert.equal(b.messages.length, 1);
  await f.client.call('delete', { run_id: first.run.run_id });
  await eventually(() => reconnected.ws.readyState === WebSocket.CLOSED);
  assert.equal(reconnected.messages.at(-1).code, 'RUN_DELETED');
  assert.equal(b.ws.readyState, WebSocket.OPEN);
});
test('a replacement tunnel changes resource generation and rejects stale resources', async t => {
  const f = await fixture(t), first = await f.client.call('open'), oldUri = first.resourceUri;
  const connected = await socket(t, f.publicUrl, first.bootstrap);
  await f.client.call('set', { run_id: first.run.run_id, value: 42, operation_id: 'keep' });
  f.tunnels.instances[0].exit();
  await eventually(() => f.status().phase === 'ready' && f.status().generation !== first.bootstrap.generation);
  await eventually(() => connected.ws.readyState === WebSocket.CLOSED);
  await assert.rejects(f.client.call('view', { uri: oldUri }), { code: 'RESOURCE_STALE' });
  const reopened = await f.client.call('open', { run_id: first.run.run_id });
  assert.notEqual(reopened.resourceUri, oldUri); assert.equal(reopened.run.value, 42);
  assert.notEqual(reopened.bootstrap.capability, first.bootstrap.capability);
  const next = await mcp(t, f.settingsPath);
  assert.equal((await next.client.listTools()).tools.find(tool => tool.name === 'open_plugin')._meta.ui.resourceUri, reopened.resourceUri);
});
test('idle shutdown waits for both MCP clients and mounted panels', async t => {
  const f = await fixture(t, { idleGraceMs: 120, heartbeatMs: 100 });
  const additional = await connectRuntime(f.settingsPath);
  const opened = await f.client.call('open'), connected = await socket(t, f.publicUrl, opened.bootstrap);
  await f.client.close(); await additional.close();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(await inspectRuntime(f.settings));
  connected.ws.terminate(); await eventually(async () => !(await inspectRuntime(f.settings)));
});
