// Optional smoke check for the shipped numeric-state example; adapt when replacing it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mcpClient, eventually } from './mcp.mjs';
import { PUBLIC_ORIGIN } from '../src/plugin/config.ts';

const rpc = mcpClient(`${PUBLIC_ORIGIN}/mcp`);
const opened = await rpc('tools/call', { name: 'open_plugin', arguments: {} });
assert.ok(!opened.isError);
const bootstrap = opened._meta['codesk/bootstrap'];
const socket = new WebSocket(bootstrap.socketUrl, ['codesk.ws', `cap.${bootstrap.capability}`]);
const messages = [];
socket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
try {
  await eventually(() => messages.length === 1);
  assert.equal(messages[0].value, 0);
  for (const [index, value] of [5, 12, 3].entries()) {
    const result = await rpc('tools/call', { name: 'set_state', arguments: {
      run_id: bootstrap.runId, value, operation_id: randomUUID(),
    } });
    assert.ok(!result.isError);
    await eventually(() => messages.length === index + 2);
    assert.equal(messages.at(-1).value, value);
    assert.equal(messages.at(-1).revision, result.structuredContent.revision);
  }
} finally {
  let closed;
  socket.addEventListener('close', event => { closed = event; }, { once: true });
  socket.close(1000, 'Verification complete');
  await eventually(() => closed, 'The deployed socket did not close cleanly');
  assert.equal(closed.code, 1000);
  assert.equal(closed.wasClean, true);
}
console.log(JSON.stringify({ verdict: 'PASS: example state over WSS; native host rendering is a separate check',
  runId: bootstrap.runId, values: messages.map(message => message.value),
  revisions: messages.map(message => message.revision) }, null, 2));
