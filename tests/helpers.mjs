import { mcpClient } from '../scripts/mcp.mjs';
export { eventually } from '../scripts/mcp.mjs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PUBLIC_ORIGIN, resourceUri as uiResourceUri } from '../src/plugin/config.ts';

export const root = resolve(import.meta.dirname, '..');
export const origin = PUBLIC_ORIGIN;
export const assetDir = resolve(root, 'dist/client');
export const resourceUri = uiResourceUri(createHash('sha256').update(await readFile(resolve(assetDir, 'index.html'))).digest('hex'));
const config = JSON.parse(await readFile(resolve(root, 'wrangler.json')));

export async function startBackend({ assetResponse, storageFixture = false } = {}) {
  const html = await readFile(resolve(assetDir, 'index.html'), 'utf8');
  const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: [{
    name: 'codesk-test', modulesRoot: root,
    modules: [...(storageFixture ? ['tests/storage-worker.mjs'] : []), 'dist/worker/index.js']
      .map(path => ({ type: 'ESModule', path: resolve(root, path) })),
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    durableObjects: { CODESK_DO: { className: 'CoDesk', useSQLite: true } },
    ...(!assetResponse ? { assets: {
      directory: assetDir, binding: 'ASSETS',
      run_worker_first: config.assets.run_worker_first,
      routerConfig: { has_user_worker: true },
      assetConfig: { html_handling: config.assets.html_handling, not_found_handling: config.assets.not_found_handling },
    } } : {}),
    // Failure fixtures override only the asset binding, never outbound HTTP.
    ...(assetResponse ? { serviceBindings: {
      ASSETS: assetResponse,
    } } : {}),
    outboundService: () => { throw new Error('Unexpected outbound fetch: UI must use ASSETS'); },
  }] }));
  const url = await mf.ready.catch(async error => { await mf.dispose(); throw error; });
  const rpc = mcpClient(new URL('/mcp', url), mf.dispatchFetch);
  const call = (name, args = {}) => rpc('tools/call', { name, arguments: args });
  return { mf, url, html, rpc, call, close: () => mf.dispose(),
    open: () => call('open_plugin'),
    set: (run_id, value, operation_id) => call('set_state', { run_id, value, operation_id }),
    state: async run_id => (await call('get_state', { run_id })).structuredContent,
    socket: async (bootstrap, capability = bootstrap.capability) => {
      const response = await mf.dispatchFetch(new URL(`/ws/${bootstrap.runId}`, url), {
        headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `codesk.ws, cap.${capability}` },
      });
      const socket = response.webSocket;
      const messages = [];
      if (socket) { socket.addEventListener('message', event => messages.push(event.data === 'pong' ? 'pong' : JSON.parse(event.data))); socket.accept(); }
      return { response, socket, messages };
    },
  };
}
