import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { startBackend, root, origin } from './helpers.mjs';

test('deployment discovery is read-only; the optional example probe exercises real WSS', { timeout: 30000 }, async t => {
  const backend = await startBackend();
  t.after(() => backend.close());
  const directory = await mkdtemp(join(tmpdir(), 'codesk-probes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const preload = join(directory, 'local-origin.mjs');
  // Keep the packaged public URLs intact; redirect requests only inside this fixture.
  await writeFile(preload, `
    import assert from 'node:assert/strict';
    const send = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input);
      assert.equal(url.origin, ${JSON.stringify(origin)});
      if (process.env.CODESK_READ_ONLY && init?.body) assert.notEqual(JSON.parse(init.body).method, 'tools/call');
      return send(new URL(url.pathname + url.search, ${JSON.stringify(backend.url.href)}), init);
    };
    const NativeSocket = globalThis.WebSocket;
    globalThis.WebSocket = class extends NativeSocket {
      constructor(url, protocols) {
        super(new URL(new URL(url).pathname, ${JSON.stringify(backend.url.href.replace('http:', 'ws:'))}), protocols);
      }
    };
  `);
  for (const script of ['verify-deployed.mjs', 'verify-example.mjs']) {
    const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, resolve(root, 'scripts', script)], {
      cwd: root, env: { ...process.env, CODESK_READ_ONLY: script === 'verify-deployed.mjs' ? '1' : '' },
    });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(exit, 0, output);
    assert.match(output, /PASS:/);
  }
});
