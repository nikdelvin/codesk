import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startBackend, eventually, resourceUri, origin } from './helpers.mjs';

test('MCP calls commit once, broadcast ordered socket state, and reconnect without losing state', { timeout: 60000 }, async () => {
  const backend = await startBackend();
  try {
    const tools = (await backend.rpc('tools/list')).tools;
    assert.deepEqual(tools.map(tool => tool.name), ['open_plugin', 'set_state', 'get_state']);
    assert.equal(tools[0]._meta.ui.resourceUri, resourceUri);
    assert.equal(tools[1]._meta?.ui?.resourceUri, undefined);
    const resource = (await backend.rpc('resources/read', { uri: resourceUri })).contents[0];
    assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
    assert.deepEqual(resource._meta.ui.csp.connectDomains, [origin, origin.replace('https:', 'wss:')]);
    const opened = await backend.open();
    const bootstrap = opened._meta['codesk/bootstrap'];
    const run = opened.structuredContent.run_id;
    assert.ok(!JSON.stringify(opened.structuredContent).includes(bootstrap.capability));
    const stream = await backend.socket(bootstrap);
    assert.equal(stream.response.status, 101);
    await eventually(() => stream.messages.length === 1);
    assert.equal(stream.messages[0].value, 0);
    for (const [index, value] of [5, 12, 3].entries()) {
      const operation = randomUUID();
      const result = await backend.set(run, value, operation);
      assert.equal(result.isError, undefined);
      await eventually(() => stream.messages.length === index + 2);
      const event = stream.messages.at(-1);
      assert.equal(event.value, value);
      assert.equal(event.revision, index + 1);
      assert.equal(event.revision, result.structuredContent.revision);
      assert.equal((await backend.set(run, value, operation)).structuredContent.duplicate, true);
      assert.equal((await backend.set(run, value + 1, operation)).isError, true);
    }
    assert.equal((await backend.state(run)).revision, 3);
    const closed = new Promise(resolve => stream.socket.addEventListener('close', resolve));
    stream.socket.close(1000);
    const closeEvent = await closed;
    assert.equal(closeEvent.code, 1000);
    await backend.set(run, 42, 'while-disconnected');
    const reconnected = await backend.socket(bootstrap);
    await eventually(() => reconnected.messages.length === 1);
    assert.equal(reconnected.messages[0].type, 'state');
    assert.equal(reconnected.messages[0].value, 42);
    assert.equal(reconnected.messages[0].revision, 4);
    reconnected.socket.close(1000);
  } finally { await backend.close(); }
});

test('runs are isolated; invalid inputs and socket mutations cannot change the state', { timeout: 60000 }, async () => {
  const backend = await startBackend();
  try {
    const first = await backend.open(), second = await backend.open();
    const a = first._meta['codesk/bootstrap'], b = second._meta['codesk/bootstrap'];
    assert.equal((await backend.socket(a, b.capability)).response.status, 401);
    const streamA = await backend.socket(a), streamB = await backend.socket(b);
    await eventually(() => streamA.messages.length && streamB.messages.length);
    const run = first.structuredContent.run_id;
    await Promise.all(Array.from({ length: 10 }, (_, i) => backend.set(run, i, `parallel-${i}`)));
    await eventually(() => streamA.messages.length === 11);
    assert.deepEqual(streamA.messages.map(message => message.revision), Array.from({ length: 11 }, (_, i) => i));
    assert.equal((await backend.state(b.runId)).value, 0);
    assert.equal(streamB.messages.length, 1);
    for (const value of [1000, -1000, 0.5, '3']) {
      const result = await backend.set(run, value, randomUUID());
      assert.equal(result.isError, true);
    }
    assert.equal((await backend.state(run)).revision, 10);
    streamA.socket.send(JSON.stringify({ type: 'set', value: 999 }));
    await eventually(() => streamA.messages.at(-1).type === 'error');
    assert.equal((await backend.state(run)).revision, 10);
    assert.equal((await backend.set(randomUUID(), 1, randomUUID())).isError, true);
    streamB.socket.close(1000);
  } finally { await backend.close(); }
});

test('UI loading rejects redirects, wrong MIME types, oversized bodies and missing HTML', { timeout: 60000 }, async () => {
  for (const assetResponse of [
    () => new Response(null, { status: 302, headers: { Location: '/index.html' } }),
    () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('x'.repeat(256001), { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('Not found', { status: 404 }),
    () => new Response('<html>SPA fallback</html>', { headers: { 'Content-Type': 'text/html' } }),
  ]) {
    const backend = await startBackend({ assetResponse });
    try {
      const result = await backend.open();
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /VIEW_UNAVAILABLE/);
    } finally { await backend.close(); }
  }
});

test('operation receipts survive later writes; limits and prototype-like IDs remain safe', { timeout: 60000 }, async t => {
  const backend = await startBackend();
  t.after(() => backend.close());
  const opened = await backend.open();
  const bootstrap = opened._meta['codesk/bootstrap'];
  const run = bootstrap.runId;
  assert.ok(Math.abs(Date.parse(bootstrap.expiresAt) - Date.now() - 3600000) < 5000);
  const streams = await Promise.all(Array.from({ length: 4 }, () => backend.socket(bootstrap)));
  assert.ok(streams.every(stream => stream.response.status === 101));
  assert.equal((await backend.socket(bootstrap)).response.status, 429);
  const first = (await backend.set(run, -999, '__proto__')).structuredContent;
  await backend.set(run, 999, 'constructor');
  assert.deepEqual((await backend.set(run, -999, '__proto__')).structuredContent, { ...first, duplicate: true });
  assert.match((await backend.set(run, 0, '__proto__')).content[0].text, /OPERATION_CONFLICT/);
  for (let i = 2; i < 256; i++) await backend.set(run, i, `operation-${i}`);
  assert.match((await backend.set(run, 0, 'overflow')).content[0].text, /OPERATION_LIMIT/);
  assert.equal((await backend.set(run, -999, '__proto__')).structuredContent.revision, 1);
  assert.deepEqual(await backend.state(run), { run_id: run, value: 255, revision: 256, expiresAt: bootstrap.expiresAt });
  streams[0].socket.send('ping');
  await eventually(() => streams[0].messages.includes('pong'));
  for (const stream of streams) stream.socket.close(1000);
});

test('expired and old stored runs are rejected; the alarm closes sockets and deletes state', { timeout: 60000 }, async t => {
  const backend = await startBackend({ storageFixture: true });
  t.after(() => backend.close());
  for (const action of ['old', 'expire', 'alarm']) {
    const bootstrap = (await backend.open())._meta['codesk/bootstrap'];
    const stream = await backend.socket(bootstrap);
    const fixture = async action => (await backend.mf.dispatchFetch(new URL('/__fixture', backend.url), {
      method: 'POST', body: JSON.stringify({ runId: bootstrap.runId, action }),
    })).json();
    await fixture(action);
    if (action === 'alarm') {
      await eventually(() => stream.messages.some(message => message.code === 'RUN_EXPIRED'));
      await eventually(async () => await fixture('read') === null);
    }
    assert.match((await backend.set(bootstrap.runId, 5, 'expired')).content[0].text, /RUN_EXPIRED/);
    assert.match((await backend.call('get_state', { run_id: bootstrap.runId })).content[0].text, /RUN_EXPIRED/);
    assert.equal((await backend.socket(bootstrap)).response.status, 410);
    stream.socket.close(1000);
  }
});
