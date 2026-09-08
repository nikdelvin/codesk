import test from 'node:test';
import { mcpClient } from '../scripts/mcp.mjs';
import assert from 'node:assert/strict';
import { createServer, preview } from 'vite';
import { createHash, randomUUID } from 'node:crypto';
import { eventually } from './helpers.mjs';
import { PLUGIN_NAME, resourceUri, SOCKET_ORIGIN } from '../src/plugin/config.ts';

for (const mode of ['development', 'preview']) {
  test(`Vite ${mode} routes MCP, sockets, assets and missing navigation in one Worker`, { timeout: 60000 }, async () => {
    const options = { host: '127.0.0.1', port: 0, strictPort: true };
    const server = mode === 'development'
      ? await createServer({ server: options, logLevel: 'error' })
      : await preview({ preview: options, logLevel: 'error' });
    let socket;
    try {
      if (mode === 'development') await server.listen();
      const address = server.httpServer.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const request = (path, init) => fetch(`${origin}${path}`, { redirect: 'manual', ...init });
      const rpc = mcpClient(`${origin}/mcp`);
      for (const path of ['/']) {
        const response = await request(path, { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } });
        assert.equal(response.status, 200, path);
        assert.match(await response.text(), /id="root"/);
      }
      for (const path of ['/mcp/unknown', '/ws', '/ws/invalid', '/some/client/route', '/health', '/api/', '/releases/missing']) {
        const response = await request(path, { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } });
        assert.equal(response.status, 404, path);
        assert.ok(!response.headers.get('Content-Type')?.includes('text/html'), path);
      }
      const mcpGet = await request('/mcp', { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } });
      assert.ok(!mcpGet.headers.get('Content-Type')?.includes('text/html'));
      const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'routing-test', version: '1' } });
      assert.equal(init.serverInfo.name, PLUGIN_NAME);
      const tools = (await rpc('tools/list')).tools;
      assert.equal(tools.length, 3);
      const uri = tools[0]._meta.ui.resourceUri;
      const resource = (await rpc('resources/read', { uri })).contents[0];
      assert.ok(resource.text.includes('<title>CoDesk</title>'));
      assert.equal(uri, resourceUri(createHash('sha256').update(resource.text).digest('hex')));
      const htmlResponse = await request('/index.html');
      assert.equal(htmlResponse.status, 200);
      assert.equal(await htmlResponse.text(), resource.text);
      assert.equal(htmlResponse.headers.get('Cache-Control'), 'no-store');
      assert.equal(htmlResponse.headers.get('Access-Control-Allow-Origin'), '*');
      for (const match of resource.text.matchAll(/(?:src|href)="([^"#]+)"/g)) {
        const url = new URL(match[1], origin);
        if (url.protocol === 'data:') continue;
        const asset = await request(url.pathname);
        assert.equal(asset.status, 200, url.pathname);
        assert.equal(asset.headers.get('Access-Control-Allow-Origin'), '*');
        assert.ok(!asset.headers.get('Content-Type')?.includes('text/html'));
      }
      if (mode === 'preview') for (const path of ['/health', '/api/', '/releases/removed/index.html', '/assets/missing.js']) {
        const response = await request(path);
        assert.equal(response.status, 404, path);
      }
      const opened = await rpc('tools/call', { name: 'open_plugin', arguments: {} });
      assert.ok(!opened.isError);
      const bootstrap = opened._meta['codesk/bootstrap'];
      const noUpgrade = await request(`/ws/${bootstrap.runId}`);
      assert.equal(noUpgrade.status, 426);
      socket = new WebSocket(bootstrap.socketUrl.replace(SOCKET_ORIGIN, origin.replace('http:', 'ws:')),
        ['codesk.ws', `cap.${bootstrap.capability}`]);
      const messages = [];
      socket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
      await eventually(() => messages.length === 1);
      assert.equal(messages[0].value, 0);
      const changed = await rpc('tools/call', { name: 'set_state', arguments: {
        run_id: bootstrap.runId, value: 5, operation_id: randomUUID(),
      } });
      await eventually(() => messages.length === 2);
      assert.equal(messages[1].revision, changed.structuredContent.revision);
      assert.equal(messages[1].value, 5);
      const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
      socket.close(1000);
      const closeEvent = await closed;
      assert.equal(closeEvent.code, 1000);
      assert.equal(closeEvent.wasClean, true);
    } finally {
      socket?.close(1000);
      await server.close();
    }
  });
}
