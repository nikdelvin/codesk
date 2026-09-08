import test from 'node:test';
import assert from 'node:assert/strict';
import { startBackend, eventually } from './helpers.mjs';

test('session snapshots, retry receipts and open sockets survive hibernation', { timeout: 60000 }, async t => {
  const backend = await startBackend();
  t.after(() => backend.close());
  const bootstrap = (await backend.open())._meta['codesk/bootstrap'];
  const stream = await backend.socket(bootstrap);
  const first = (await backend.set(bootstrap.runId, 5, 'first')).structuredContent;
  await eventually(() => stream.messages.length === 2);
  await backend.mf.unsafeEvictDurableObject('codesk-test', 'CoDesk', { name: bootstrap.runId, webSockets: 'hibernate' });
  stream.socket.send('ping');
  await eventually(() => stream.messages.includes('pong'));
  assert.deepEqual((await backend.set(bootstrap.runId, 5, 'first')).structuredContent, { ...first, duplicate: true });
  await backend.set(bootstrap.runId, 12, 'second');
  await eventually(() => stream.messages.at(-1).value === 12);
  assert.equal(stream.messages.at(-1).revision, 2);
  const reconnected = await backend.socket(bootstrap);
  await eventually(() => reconnected.messages.length === 1);
  assert.equal(reconnected.messages[0].value, 12);
  assert.equal(reconnected.messages[0].revision, 2);
  stream.socket.close(1000);
  reconnected.socket.close(1000);
});

test('the unchanged relay sends application-defined object snapshots and broadcasts within one session', { timeout: 60000 }, async t => {
  const backend = await startBackend({ storageFixture: true });
  t.after(() => backend.close());
  const bootstrap = (await backend.open())._meta['codesk/bootstrap'];
  const other = await backend.socket((await backend.open())._meta['codesk/bootstrap']);
  const frame = { schemaVersion: 2, type: 'state', runId: bootstrap.runId, revision: 0,
    value: { title: 'A different application', items: ['one', 'two'], complete: false } };
  const fixture = async (action, message) => {
    const response = await backend.mf.dispatchFetch(new URL('/__fixture', backend.url), {
      method: 'POST', body: JSON.stringify({ runId: bootstrap.runId, action, message }),
    });
    assert.equal(response.status, 200);
    await response.text();
  };
  await fixture('snapshot', frame);
  const streams = await Promise.all([backend.socket(bootstrap), backend.socket(bootstrap)]);
  await eventually(() => streams.every(stream => stream.messages.length === 1) && other.messages.length === 1);
  for (const stream of streams) assert.deepEqual(stream.messages[0], frame);
  const updated = { ...frame, revision: 1, value: { ...frame.value, complete: true } };
  await fixture('snapshot', updated);
  await fixture('broadcast', updated);
  await eventually(() => streams.every(stream => stream.messages.length === 2));
  for (const stream of streams) assert.deepEqual(stream.messages[1], updated);
  assert.equal(other.messages.length, 1);
  const reconnected = await backend.socket(bootstrap);
  await eventually(() => reconnected.messages.length === 1);
  assert.deepEqual(reconnected.messages[0], updated);
  for (const stream of [...streams, reconnected, other]) stream.socket.close(1000);
});
