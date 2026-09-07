import assert from 'node:assert/strict';
import { mcpClient, discoverApp } from './mcp.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { PLUGIN_NAME, PUBLIC_ORIGIN as origin, resourceUri, UI_PATH } from '../src/plugin/config.ts';
const localHtml = await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8');
const htmlHash = createHash('sha256').update(localHtml).digest('hex');
const rpc = mcpClient(`${origin}/mcp`);
const resource = await discoverApp(rpc, PLUGIN_NAME);
assert.equal(resource.uri, resourceUri(htmlHash));
assert.equal(resource.text, localHtml);
const htmlResponse = await fetch(`${origin}${UI_PATH}`, { redirect: 'manual' });
assert.equal(htmlResponse.status, 200);
assert.equal(htmlResponse.headers.get('Cache-Control'), 'no-store');
assert.equal(await htmlResponse.text(), resource.text);
let assetCount = 0;
for (const match of resource.text.matchAll(/(?:src|href)="(https:[^"]+)"/g)) {
  const response = await fetch(match[1], { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, match[1]);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.ok(!response.headers.get('Content-Type')?.includes('text/html'));
  assert.match(response.headers.get('Cache-Control'), /immutable/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(new URL(`../dist/client${new URL(match[1]).pathname}`, import.meta.url)));
  assetCount++;
}
for (const path of ['/some/client/route', '/assets/missing.js', '/health', '/api/', '/releases/removed/index.html']) {
  const missing = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10000) });
  assert.equal(missing.status, 404, path);
}
console.log(JSON.stringify({ verdict: 'PASS: MCP discovery, packaged UI, assets, caching and routes',
  resourceUri: resource.uri, assetCount }, null, 2));
