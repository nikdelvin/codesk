import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startBackend, assetDir } from './helpers.mjs';
import { resourceUri } from '../src/plugin/config.ts';

test('current HTML is uncached; hashed assets keep CORS and immutable caching', { timeout: 60000 }, async () => {
  const backend = await startBackend();
  try {
    const get = path => backend.mf.dispatchFetch(new URL(path, backend.url));
    for (const path of ['/', '/index.html']) {
      const response = await get(path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.match(await response.text(), /name="codesk-ui" content="app"/);
    }
    const head = await backend.mf.dispatchFetch(new URL('/index.html', backend.url), { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('Cache-Control'), 'no-store');
    assert.equal(await head.text(), '');
    const html = await (await get('/index.html')).text();
    for (const match of html.matchAll(/(?:src|href)="(https:[^"]+)"/g)) {
      const path = new URL(match[1]).pathname;
      assert.match(path, /^\/assets\/.+-[\w-]+\./);
      const asset = await get(path);
      assert.equal(asset.status, 200);
      assert.equal(asset.headers.get('Access-Control-Allow-Origin'), '*');
      assert.match(asset.headers.get('Cache-Control'), /immutable/);
      assert.ok(!asset.headers.get('Content-Type')?.includes('text/html'));
      await asset.arrayBuffer();
    }
    for (const path of ['/health', '/api/', '/releases/removed/index.html', '/assets/missing.js']) {
      const response = await get(path);
      assert.equal(response.status, 404, path);
      await response.text();
    }
  } finally { await backend.close(); }
});

test('MCP resource identity follows current HTML without an isolate cache or manual version', { timeout: 60000 }, async () => {
  let html = await readFile(resolve(assetDir, 'index.html'), 'utf8');
  const backend = await startBackend({ assetResponse: () => new Response(html, { headers: { 'Content-Type': 'text/html' } }) });
  try {
    const discover = async () => (await backend.rpc('tools/list')).tools[0]._meta.ui.resourceUri;
    const first = await discover();
    assert.equal(first, resourceUri(createHash('sha256').update(html).digest('hex')));
    // A new Vite asset filename must change the host resource cache key.
    html = html.replace(/\/assets\/index-[\w-]+\.js/, '/assets/index-new-build.js');
    const second = await discover();
    assert.notEqual(second, first);
    assert.equal(second, resourceUri(createHash('sha256').update(html).digest('hex')));
    const resource = (await backend.rpc('resources/read', { uri: second })).contents[0];
    assert.equal(resource.text, html);
    await assert.rejects(backend.rpc('resources/read', { uri: first }), /not found/i);
    const opened = await backend.open();
    assert.equal(opened._meta['codesk/bootstrap'].schemaVersion, 2);
  } finally { await backend.close(); }
});
