import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { fixture, eventually } from './helpers.mjs';
import { renderView, inspectRuntime } from '../dist/library.mjs';
const assets = JSON.parse(readFileSync(new URL('../dist/ui-assets.json', import.meta.url)));

test('only hashed, byte-identical manifest assets are public; MP4 ranges and font CORS work', async t => {
  const f = await fixture(t);
  for (const [path, info] of Object.entries(assets)) {
    const response = await fetch(`${f.publicUrl}/${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('cache-control'), /immutable/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, info.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), info.sha256);
    const head = await fetch(`${f.publicUrl}/${path}`, { method: 'HEAD' });
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(Number(head.headers.get('content-length')), info.bytes);
    assert.equal((await fetch(`${f.publicUrl}/${path}`, { method: 'POST' })).status, 405);
  }
  const path = Object.keys(assets).find(path => path.endsWith('.mp4'));
  for (const [range, length] of [['bytes=0-31',32], ['bytes=-32',32], ['bytes=32-',assets[path].bytes-32]]) {
    const response = await fetch(`${f.publicUrl}/${path}`, { headers: { Range: range } });
    assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, length);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
  }
  for (const range of ['bytes=1-0','bytes=-0','bytes=99999999-','bytes=0-1,3-4','bytes=-','garbage']) {
    assert.equal((await fetch(`${f.publicUrl}/${path}`, { headers: { Range: range } })).status, 416);
  }
  for (const path of ['/ui-assets/unknown.mp4', '/ui-assets/%2e%2e/state.sqlite', '/ui-assets/../runtime.json', '/ui-assets/%2fetc/passwd', '/ui-assets.json', '/build.json']) {
    const status = await new Promise((resolve,reject) => {
      const req = httpRequest(f.publicUrl, { path }, response => { response.resume(); resolve(response.statusCode); }); req.on('error',reject); req.end();
    });
    assert.equal(status, 404, path);
  }
});

test('asset URLs and both CSP metadata formats change with tunnel generation, without capabilities', async t => {
  const f = await fixture(t), first = await f.client.call('open');
  const check = async opened => {
    const view = (await f.client.call('view', { uri: opened.resourceUri })).contents[0];
    const origin = new URL(opened.bootstrap.socketUrl).origin.replace('wss:','https:');
    assert.deepEqual(view._meta.ui.csp.resourceDomains, [origin]);
    assert.deepEqual(view._meta['openai/widgetCSP'].resource_domains, [origin]);
    for (const path of Object.keys(assets)) assert.ok(view.text.includes(`${origin}/${path}`));
    assert.ok(!view.text.includes(opened.bootstrap.capability));
    assert.ok(!view.text.includes('https://codesk-assets.invalid'));
    return view;
  };
  const old = await check(first);
  f.tunnels.instances[0].exit();
  await eventually(() => f.status().phase === 'ready' && f.status().generation !== first.bootstrap.generation);
  const next = await f.client.call('open', { run_id: first.run.run_id });
  assert.notEqual((await check(next)).text, old.text);
  assert.throws(() => renderView('<!--CODESK_RUNTIME-->', 'https://untrusted.test', 'x'));
});

test('media requests do not keep an otherwise idle runtime alive', async t => {
  const f = await fixture(t, { idleGraceMs: 100 });
  await fetch(`${f.publicUrl}/${Object.keys(assets)[0]}`);
  assert.equal(f.status().sockets, 0);
  await f.client.close();
  await eventually(async () => !(await inspectRuntime(f.settings)));
});
