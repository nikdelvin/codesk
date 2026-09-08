import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { packagePlugin, installPlugin } from '../scripts/plugin.mjs';
import { verifyDigest } from '../scripts/cloudflared.mjs';
import { writeJson, readJson } from '../scripts/project.mjs';
import { Store } from '../dist/library.mjs';
import { temporary, configuration, fixture, mcp } from './helpers.mjs';

test('packaged stdio loads without source or node_modules from another cwd', async t => {
  const f = await fixture(t), destination = join(f.directory, 'plugins/codesk-local');
  packagePlugin(destination, f.settings);
  assert.ok(!existsSync(join(destination, 'node_modules'))); assert.ok(!existsSync(join(destination, 'src')));
  const config = readJson(join(destination, '.mcp.json')).mcpServers['codesk-local'];
  assert.equal(config.command, process.execPath);
  const packaged = await mcp(t, config.args[1], config.args[0], f.directory);
  const opened = await packaged.tool('open_plugin'); assert.ok(!opened.isError);
  const view = await packaged.client.readResource({ uri: opened._meta.ui.resourceUri });
  assert.ok(view.contents[0].text.includes('codesk-runtime'));
  assert.ok(!/<script\b[^>]*\bsrc=|<link\b/i.test(view.contents[0].text));
  const withoutArguments = await mcp(t, undefined, config.args[0], f.directory);
  const recovered = await withoutArguments.tool('get_state', { run_id: opened.structuredContent.run_id });
  assert.equal(recovered.structuredContent.value, 0, 'Bundle-relative settings survive a host omitting extra arguments');
});
test('installation refresh preserves saved data and unrelated marketplace entries', async t => {
  const directory = temporary(t), config = configuration(directory);
  const marketplacePath = join(directory, '.agents/plugins/marketplace.json');
  const unrelated = { name: 'unrelated', source: { source: 'local', path: './plugins/unrelated' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_USE' }, category: 'Productivity' };
  writeJson(marketplacePath, { name: 'personal', interface: { displayName: 'My plugins' }, plugins: [unrelated] });
  writeJson(join(config.dataDir, 'installation.json'), { installationId: config.installationId });
  let store = new Store(join(config.dataDir, 'state.sqlite')); const run = store.open(0); store.set(run.run_id, 42, 'keep'); store.close();
  const calls = [], options = { userDirectory: directory, stagingRoot: join(directory, 'staging'), config,
    invokeCodex: args => calls.push(args) };
  const destination = await installPlugin(options), manifestPath = join(destination, '.codex-plugin/plugin.json');
  const firstVersion = readJson(manifestPath).version;
  const marketplaceBefore = readFileSync(marketplacePath, 'utf8');
  await installPlugin(options);
  assert.notEqual(readJson(manifestPath).version, firstVersion);
  assert.equal(readFileSync(marketplacePath, 'utf8'), marketplaceBefore);
  assert.deepEqual(readJson(marketplacePath).plugins[0], unrelated);
  assert.equal(readJson(marketplacePath).interface.displayName, 'My plugins');
  assert.deepEqual(calls, Array(2).fill(['plugin', 'add', 'codesk-local@personal']));
  store = new Store(join(config.dataDir, 'state.sqlite')); t.after(() => store.close());
  assert.equal(store.get(run.run_id).value, 42); assert.equal(store.set(run.run_id, 42, 'keep').duplicate, true);
  const installedBefore = readFileSync(manifestPath, 'utf8');
  await assert.rejects(installPlugin({ ...options, invokeCodex: () => { throw new Error('fixture install failure'); } }));
  assert.equal(readFileSync(manifestPath, 'utf8'), installedBefore);
});
test('verified downloader rejects corrupted bytes and ships pinned official hashes', () => {
  const bytes = Buffer.from('fixture'), digest = createHash('sha256').update(bytes).digest('hex');
  verifyDigest(bytes, digest); assert.throws(() => verifyDigest(Buffer.from('changed'), digest), /checksum mismatch/);
  const release = readJson(new URL('../scripts/cloudflared-release.json', import.meta.url));
  assert.equal(release.version, '2026.3.0');
  for (const asset of Object.values(release.platforms)) {
    assert.match(asset.url, /^https:\/\/github.com\/cloudflare\/cloudflared\/releases\/download\/2026\.3\.0\//);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  }
});
