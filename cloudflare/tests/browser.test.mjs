import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { startBackend, eventually, assetDir, resourceUri, origin } from './helpers.mjs';
import { DISPLAY_NAME } from '../src/plugin/config.ts';

async function fixture(t, socketHandler) {
  const backend = await startBackend();
  t.after(() => backend.close());
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  const opened = await backend.open();
  const bootstrap = opened._meta['codesk/bootstrap'];
  const html = (await backend.rpc('resources/read', { uri: resourceUri })).contents[0].text;
  const viewUrl = new URL('/__view', backend.url).href;
  const localWs = backend.url.href.replace('http:', 'ws:').replace(/\/$/, '');
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  await context.route(`${origin}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ body: html, contentType: 'text/html' });
    assert.match(path, /^\/assets\/[\w.-]+$/);
    await route.fulfill({ body: await readFile(resolve(assetDir, path.slice(1))),
      contentType: { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.mp4': 'video/mp4', '.webp': 'image/webp', '.woff2': 'font/woff2' }[extname(path)],
      headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await context.addInitScript(({ origin, localWs }) => {
    const NativeSocket = window.WebSocket;
    window.sockets = [];
    window.WebSocket = class extends NativeSocket {
      constructor(url, protocols) {
        super(String(url).replace(origin.replace('https:', 'wss:'), localWs), protocols);
        window.sockets.push(this);
        this.messages = [];
        this.addEventListener('message', event => this.messages.push(event.data));
      }
    };
  }, { origin, localWs });
  await context.route(viewUrl, route => route.fulfill({ body: html, contentType: 'text/html', headers: {
    'Content-Security-Policy': `default-src 'none'; script-src ${origin}; style-src 'unsafe-inline' ${origin}; img-src data: ${origin}; font-src ${origin}; media-src ${origin}; connect-src ${localWs};`,
  } }));
  const hostUrl = new URL('/__host', backend.url).href;
  await context.route(hostUrl, route => route.fulfill({ body: '<!doctype html><iframe title="plugin" sandbox="allow-scripts allow-same-origin" style="width:100%;height:500px;border:0"></iframe>', contentType: 'text/html' }));
  if (socketHandler) {
    await page.clock.install();
    await page.routeWebSocket(/\/ws\//, socket => socketHandler(socket, bootstrap));
  }
  await page.goto(hostUrl);
  await page.evaluate(({ opened, viewUrl }) => {
    const frame = document.querySelector('iframe');
    window.modes = [];
    window.notify = (method, params) => frame.contentWindow.postMessage({ jsonrpc: '2.0', method, params }, '*');
    window.addEventListener('message', event => {
      if (event.source !== frame.contentWindow) return;
      const { method, id, params } = event.data;
      if (method === 'ui/initialize') frame.contentWindow.postMessage({ jsonrpc: '2.0', id, result: {
        protocolVersion: params.protocolVersion, hostInfo: { name: 'Fixture', version: '1' },
        hostCapabilities: {}, hostContext: { displayMode: 'inline' },
      } }, '*');
      if (method === 'ui/notifications/initialized') window.initialized = true;
      if (method === 'ui/request-display-mode') {
        window.modes.push(params.mode);
        frame.contentWindow.postMessage({ jsonrpc: '2.0', id, result: { mode: params.mode } }, '*');
      }
    });
    window.openResult = opened;
    frame.src = viewUrl;
  }, { opened, viewUrl });
  await page.waitForFunction(() => window.initialized);
  const frame = page.frames().find(frame => frame.url() === viewUrl);
  const value = frame.locator('output');
  const rendered = count => frame.waitForFunction(count => document.querySelector('output')?.textContent === String(count), count);
  const notify = (method, params) => page.evaluate(({ method, params }) => window.notify(method, params), { method, params });
  const start = () => notify('ui/notifications/tool-result', { ...opened, structuredContent: { value: 999, revision: 999 } });
  return { backend, context, page, frame, value, rendered, notify, start, bootstrap, viewUrl, errors, requests };
}

test('standard bridge and real sockets update one React mount through fullscreen and reconnect', { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const { backend, page, frame, value, bootstrap, context, rendered, notify } = f;
  await frame.getByRole('heading', { name: DISPLAY_NAME, exact: true }).waitFor();
  assert.equal(await frame.title(), 'CoDesk');
  assert.equal(await value.textContent(), '—');
  // Reject malformed, old-version and untrusted-origin bootstrap before accepting the real one.
  for (const invalid of [{ ...bootstrap, schemaVersion: 1 }, { ...bootstrap, socketUrl: `wss://untrusted.test/ws/${bootstrap.runId}` }, {}]) {
    await notify('ui/notifications/tool-result', { content: [], _meta: { 'codesk/bootstrap': invalid } });
  }
  assert.equal(await frame.evaluate(() => window.sockets.length), 0);
  await f.start();
  await rendered(0);
  const original = await value.elementHandle();
  await frame.getByRole('button', { name: 'Open fullscreen', exact: true }).click();
  await frame.getByRole('button', { name: 'Return to inline', exact: true }).waitFor();
  for (const [index, count] of [5, 12, 3].entries()) {
    const result = await backend.set(bootstrap.runId, count, randomUUID());
    await rendered(count);
    assert.equal(result.structuredContent.revision, index + 1);
    assert.ok(await value.evaluate((element, original) => element === original, original));
    assert.ok(await frame.evaluate(revision => window.sockets[0].messages.some(data => JSON.parse(data).revision === revision), index + 1));
  }
  await frame.getByRole('button', { name: 'Return to inline', exact: true }).click();
  await frame.getByRole('button', { name: 'Open fullscreen', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.modes), ['fullscreen', 'inline']);
  assert.equal(await frame.evaluate(() => window.sockets.length), 1);
  for (const mode of ['fullscreen', 'inline']) {
    await notify('ui/notifications/host-context-changed', { displayMode: mode });
    await frame.getByRole('button', { name: mode === 'fullscreen' ? 'Return to inline' : 'Open fullscreen', exact: true }).waitFor();
  }
  await notify('ui/notifications/tool-result', { content: [], structuredContent: { value: 777, revision: 777 } });
  const fake = { schemaVersion: 2, type: 'state', runId: bootstrap.runId, revision: 100, value: 999 };
  await frame.evaluate(messages => messages.forEach(data => window.sockets[0].dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }))),
    [{ ...fake, runId: randomUUID() }, { ...fake, revision: 2 }, { ...fake, value: '999' }]);
  await value.dispatchEvent('click');
  assert.equal(await value.textContent(), '3');
  assert.equal((await backend.state(bootstrap.runId)).revision, 3);
  await context.setOffline(true);
  await frame.evaluate(() => Promise.all(window.sockets.map(socket => new Promise(resolve => {
    socket.addEventListener('close', resolve, { once: true }); socket.close();
  }))));
  await backend.set(bootstrap.runId, 42, 'offline');
  await context.setOffline(false);
  await rendered(42);
  assert.ok(await value.evaluate((element, original) => element === original, original));
  assert.ok(!f.requests.some(url => new URL(url).origin === origin && !new URL(url).pathname.startsWith('/assets/')));
  assert.deepEqual(f.errors, []);
  const standalone = await context.newPage();
  await standalone.goto(`${origin}/`);
  assert.equal(await standalone.locator('output').textContent(), '—');
  await standalone.getByRole('button', { name: 'Open fullscreen', exact: true }).click();
  await standalone.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await standalone.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await standalone.waitForFunction(() => document.fullscreenElement === null);
  await standalone.getByText('Unconnected preview', { exact: true }).waitFor();
  await standalone.evaluate(() => document.fonts.ready);
  assert.equal(await standalone.locator('.rain-container').count(), 0);
  assert.equal(await standalone.locator('.lines-1, .lines-2').count(), 2);
  await standalone.setViewportSize({ width: 800, height: 600 });
  await mkdir('test-results', { recursive: true });
  await standalone.screenshot({ path: 'test-results/codesk-cloudflare.png' });
  for (const width of [320, 390, 1024, 1440]) {
    await standalone.setViewportSize({ width, height: 900 });
    assert.ok(await standalone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}px`);
    assert.equal(await standalone.locator('output').textContent(), '—');
  }
});

for (const missing of ['initial state', 'pong']) {
  test(`missing ${missing} reconnects; expiration stops the socket`, { timeout: 30000 }, async t => {
    let connections = 0;
    const f = await fixture(t, (socket, bootstrap) => {
      connections++;
      if (missing === 'pong' || connections > 1) socket.send(JSON.stringify({ schemaVersion: 2, type: 'state', runId: bootstrap.runId, revision: 0, value: 0 }));
      socket.onMessage(() => {}); // Intentionally leave heartbeat requests unanswered.
    });
    await f.start();
    await eventually(() => connections === 1);
    if (missing === 'pong') { await f.rendered(0); await f.page.clock.runFor(25000); }
    else assert.equal(await f.value.textContent(), '—');
    await f.page.clock.runFor(10001);
    await f.frame.getByRole('status').filter({ hasText: 'Disconnected' }).waitFor();
    await f.page.clock.runFor(251);
    await eventually(() => connections === 2);
    await f.rendered(0);
    await f.page.clock.fastForward(3600000);
    await f.frame.getByRole('status').filter({ hasText: 'expired' }).waitFor();
    assert.ok(await f.frame.evaluate(() => window.sockets.every(socket => socket.readyState === WebSocket.CLOSED)));
  });
}
