import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { fixture, mcp, eventually } from './helpers.mjs';

test('React uses real socket state in one mount, handles reconnect, and retains fullscreen controls', { timeout: 30000 }, async t => {
  const f = await fixture(t), backend = await mcp(t, f.settingsPath);
  const opened = await backend.tool('open_plugin'), bootstrap = opened._meta['codesk/bootstrap'];
  const view = (await backend.client.readResource({ uri: opened._meta.ui.resourceUri })).contents[0];
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true }); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
  const localWs = f.publicUrl.replace('http:', 'ws:'), remoteWs = new URL(bootstrap.socketUrl).origin;
  // Browser-only host/transport fixtures. Actual stdio MCP and local WebSockets
  // drive all mutations. Live trusted WSS is covered separately by verify:tunnel.
  await context.addInitScript(({ localWs, remoteWs }) => {
    const Native = window.WebSocket; window.sockets = [];
    window.WebSocket = class extends Native {
      constructor(url, protocols) { super(String(url).replace(remoteWs, localWs), protocols); window.sockets.push(this); }
    };
  }, { localWs, remoteWs });
  const viewUrl = `${f.publicUrl}/__view`, hostUrl = `${f.publicUrl}/__host`;
  await context.route(viewUrl, route => route.fulfill({ body: view.text, contentType: 'text/html', headers: {
    'Content-Security-Policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src ${localWs};`,
  } }));
  await context.route(hostUrl, route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><iframe sandbox="allow-scripts allow-same-origin" style="width:100%;height:550px;border:0"></iframe>' }));
  await page.goto(hostUrl);
  await page.evaluate(({ opened, viewUrl }) => {
    const iframe = document.querySelector('iframe'); window.modes = [];
    window.notify = (method, params) => iframe.contentWindow.postMessage({ jsonrpc: '2.0', method, params }, '*');
    window.addEventListener('message', event => {
      if (event.source !== iframe.contentWindow) return;
      const { id, method, params } = event.data;
      if (method === 'ui/initialize') iframe.contentWindow.postMessage({ jsonrpc: '2.0', id, result: {
        protocolVersion: params.protocolVersion, hostInfo: { name: 'Browser fixture', version: '1' },
        hostCapabilities: {}, hostContext: { displayMode: 'inline' },
      } }, '*');
      if (method === 'ui/notifications/initialized') window.initialized = true;
      if (method === 'ui/request-display-mode') {
        window.modes.push(params.mode); iframe.contentWindow.postMessage({ jsonrpc: '2.0', id, result: { mode: params.mode } }, '*');
      }
    });
    window.opened = opened; iframe.src = viewUrl;
  }, { opened, viewUrl });
  await page.waitForFunction(() => window.initialized);
  const frame = page.frames().find(frame => frame.url() === viewUrl), output = frame.locator('output');
  assert.equal(await output.textContent(), '—');
  await page.evaluate(bootstrap => window.notify('ui/notifications/tool-result', { content: [],
    _meta: { 'codesk/bootstrap': { ...bootstrap, socketUrl: 'wss://untrusted.test/ws/' + bootstrap.runId } } }), bootstrap);
  assert.equal(await frame.evaluate(() => window.sockets.length), 0);
  await page.evaluate(() => window.notify('ui/notifications/tool-result', { ...window.opened, structuredContent: { value: 999, revision: 999 } }));
  const rendered = value => frame.waitForFunction(value => document.querySelector('output')?.textContent === String(value), value);
  await rendered(0); const element = await output.elementHandle();
  for (const value of [5, 12, 3]) {
    await backend.tool('set_state', { run_id: bootstrap.runId, value, operation_id: randomUUID() }); await rendered(value);
    assert.ok(await output.evaluate((current, original) => current === original, element));
  }
  await frame.getByRole('button', { name: 'Open fullscreen', exact: true }).click();
  await frame.getByRole('button', { name: 'Return to inline', exact: true }).click();
  await frame.getByRole('button', { name: 'Open fullscreen', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.modes), ['fullscreen', 'inline']);
  await page.evaluate(() => window.notify('ui/notifications/tool-result', { content: [], structuredContent: { value: 777, revision: 777 } }));
  await frame.evaluate(({ runId }) => {
    for (const frame of [
      { runId, revision: 2, value: 888 }, { runId: crypto.randomUUID(), revision: 200, value: 888 }, { runId, revision: 200, value: '888' },
    ]) window.sockets[0].dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ schemaVersion: 3, type: 'state', ...frame }) }));
  }, { runId: bootstrap.runId });
  assert.equal(await output.textContent(), '3');
  await context.setOffline(true); await frame.evaluate(() => window.sockets.at(-1).close());
  await eventually(() => f.status().sockets === 0);
  await backend.tool('set_state', { run_id: bootstrap.runId, value: 42, operation_id: 'offline' });
  await context.setOffline(false); await rendered(42);
  assert.ok(await output.evaluate((current, original) => current === original, element));
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => [viewUrl, hostUrl].includes(url)), 'The self-contained panel requests no external assets');
  const standalone = await context.newPage(); await standalone.goto(f.publicUrl);
  for (const width of [375, 1280]) {
    await standalone.setViewportSize({ width, height: 900 });
    assert.ok(await standalone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await standalone.locator('output').textContent(), '—');
  }
  await backend.tool('delete_run', { run_id: bootstrap.runId });
  await frame.getByRole('status').filter({ hasText: 'deleted' }).waitFor();
});
