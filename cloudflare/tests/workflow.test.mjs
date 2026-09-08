import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readJson, root, writeJson } from '../scripts/project.mjs';

const account = 'a'.repeat(32);
const otherAccount = 'b'.repeat(32);
function fixture(t) {
  const directory = mkdtempSync(resolve(tmpdir(), 'codesk-workflow-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const path of ['scripts', 'src', 'plugin', 'wrangler.json', 'app.config.json', 'LICENSE']) cpSync(resolve(root, path), resolve(directory, path), { recursive: true });
  const configPath = resolve(directory, 'wrangler.json');
  const appConfigPath = resolve(directory, 'app.config.json');
  const logPath = resolve(directory, 'commands.jsonl');
  const wrangler = resolve(directory, 'node_modules/wrangler/bin/wrangler.js');
  mkdirSync(resolve(wrangler, '..'), { recursive: true });
  writeFileSync(wrangler, `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + '\\n');
    if (args[0] === 'whoami') console.log(JSON.stringify({ loggedIn: true, accounts: [{ id: '${account}' }] }));
    else if (args[0] === 'auth') console.log(JSON.stringify({ type: 'oauth', token: 'fixture-secret-never-print' }));
    else if (args[0] !== 'deploy') process.exit(1);
  `);
  const preload = resolve(directory, 'network-fixture.mjs');
  writeFileSync(preload, `
    import assert from 'node:assert/strict';
    globalThis.fetch = async (url, init) => {
      if (url === 'https://my-desk.actual-account.workers.dev/mcp') {
        const { id, method } = JSON.parse(init.body);
        const uri = 'ui://workspace/home.html';
        const results = {
          initialize: { serverInfo: { name: process.env.CODESK_TEST_MCP_NAME ?? 'different-plugin' } },
          'tools/list': { tools: [{ name: 'show_workspace', _meta: { ui: { resourceUri: uri } } }] },
          'resources/read': { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: '<html>Workspace</html>' }] },
        };
        assert.ok(method in results, 'Installation must not call application tools');
        return Response.json({ jsonrpc: '2.0', id, result: results[method] });
      }
      assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain');
      assert.equal(init.headers.Authorization, 'Bearer fixture-secret-never-print');
      assert.ok(!init.method || init.method === 'GET');
      return Response.json(process.env.CODESK_TEST_NO_SUBDOMAIN
        ? { success: false, errors: [{ code: 10007 }] }
        : { success: true, result: { subdomain: 'actual-account' } });
    };
  `);
  writeFileSync(resolve(directory, 'scripts/verify-deployed.mjs'), `console.log('Deployment smoke fixture passed');`);
  const run = (script, args = [], env = {}) => spawnSync(process.execPath,
    ['--import', pathToFileURL(preload).href, resolve(directory, 'scripts', script), ...args],
    { cwd: directory, encoding: 'utf8', env: { ...process.env, ...env } });
  const configured = () => {
    const config = readJson(configPath);
    config.name = 'my-desk';
    config.account_id = account;
    writeJson(appConfigPath, { publicOrigin: 'https://my-desk.actual-account.workers.dev', pluginName: 'daily-desk' });
    writeJson(configPath, config);
    return config;
  };
  return { directory, configPath, appConfigPath, logPath, configured, run };
}

test('configure discovers the real account subdomain and leaves files intact on invalid input', t => {
  const f = fixture(t);
  const original = readJson(f.configPath);
  const result = f.run('configure.mjs', ['--plugin-name', 'my-desk']);
  assert.equal(result.status, 0, result.stderr);
  const next = readJson(f.configPath);
  const publicConfig = readJson(f.appConfigPath);
  assert.equal(readJson(f.appConfigPath).publicOrigin, 'https://my-desk.actual-account.workers.dev');
  assert.equal(next.account_id, account);
  assert.equal(next.name, 'my-desk');
  assert.equal(publicConfig.pluginName, 'my-desk');
  assert.deepEqual(next.durable_objects, original.durable_objects);
  assert.deepEqual(next.exports, original.exports);
  assert.ok(!(result.stdout + result.stderr + readFileSync(f.configPath)).includes('fixture-secret'));
  for (const args of [['--name', '../bad'], ['--name', '-bad'], ['--name', 'x'.repeat(64)],
    ['--name', 'valid', '--account', otherAccount], ['--name', 'valid', '--subdomain', 'guessed']]) {
    assert.notEqual(f.run('configure.mjs', ['--plugin-name', 'my-desk', ...args]).status, 0);
    assert.deepEqual(readJson(f.configPath), next);
    assert.deepEqual(readJson(f.appConfigPath), publicConfig);
  }
  const missing = f.run('configure.mjs', ['--plugin-name', 'valid'], { CODESK_TEST_NO_SUBDOMAIN: '1' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /register a subdomain/);
  assert.deepEqual(readJson(f.configPath), next);
  assert.deepEqual(readJson(f.appConfigPath), publicConfig);
  for (const pluginName of ['../outside', 'My Desk', 'two--hyphens', 'x'.repeat(64), '']) {
    assert.notEqual(f.run('configure.mjs', ['--plugin-name', pluginName]).status, 0);
    assert.deepEqual(readJson(f.configPath), next);
    assert.deepEqual(readJson(f.appConfigPath), publicConfig);
  }
  const renamed = f.run('configure.mjs', ['--plugin-name', 'daily-desk', '--name', 'my-desk']);
  assert.equal(renamed.status, 0, renamed.stderr);
  assert.equal(readJson(f.configPath).name, 'my-desk');
  assert.equal(readJson(f.appConfigPath).pluginName, 'daily-desk');
});

test('deploy checks the account and actual URL before publishing; dry-run never publishes', t => {
  const f = fixture(t);
  const config = f.configured();
  for (const change of [{ account_id: otherAccount }, { publicOrigin: 'https://my-desk.guessed.workers.dev' }]) {
    f.configured();
    if (change.publicOrigin) writeJson(f.appConfigPath, { ...readJson(f.appConfigPath), ...change });
    else writeJson(f.configPath, { ...config, ...change });
    const result = f.run('deploy.mjs');
    assert.notEqual(result.status, 0);
    assert.ok(!readFileSync(f.logPath, 'utf8').includes('["deploy"'));
  }
  f.configured();
  const result = f.run('deploy.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Deployment smoke fixture passed/);
  writeFileSync(f.logPath, '');
  delete config.account_id;
  writeJson(f.configPath, config);
  const dryRun = f.run('deploy.mjs', ['--dry-run']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(readFileSync(f.logPath, 'utf8'), '["deploy","--dry-run"]\n');
  assert.ok(!dryRun.stdout.includes('smoke'));
});

test('a standalone checkout packages the configured endpoint and installs with the real Codex CLI', { timeout: 60000 }, t => {
  const f = fixture(t);
  f.configured();
  const source = readFileSync(resolve(f.directory, 'plugin/.codex-plugin/plugin.json'), 'utf8');
  const mismatched = f.run('plugin.mjs');
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /deployed app uses a different plugin name/);
  assert.ok(!existsSync(resolve(f.directory, '.plugin-build')));
  const result = f.run('plugin.mjs', ['--build-only']);
  assert.equal(result.status, 0, result.stderr);
  const destination = resolve(f.directory, '.plugin-build');
  const packagePath = resolve(destination, 'plugins/daily-desk');
  const manifest = readJson(resolve(packagePath, '.codex-plugin/plugin.json'));
  const marketplace = readJson(resolve(destination, '.agents/plugins/marketplace.json'));
  assert.equal(manifest.name, 'daily-desk');
  assert.equal(manifest.interface.displayName, 'Daily Desk');
  assert.equal(manifest.interface.defaultPrompt[0], 'Open Daily Desk');
  assert.equal(manifest.version.split('+')[0], JSON.parse(source).version);
  assert.match(manifest.version, /\+codex\.\d{14}$/);
  assert.equal(readJson(resolve(packagePath, '.mcp.json')).mcpServers[marketplace.name].url,
    'https://my-desk.actual-account.workers.dev/mcp');
  assert.ok(existsSync(resolve(packagePath, 'skills/open-plugin/SKILL.md')));
  assert.equal(readFileSync(resolve(f.directory, 'plugin/.codex-plugin/plugin.json'), 'utf8'), source);
  const profile = resolve(f.directory, 'codex-profile');
  mkdirSync(profile);
  const cliShim = resolve(f.directory, 'node_modules/@openai/codex/bin/codex.js');
  mkdirSync(resolve(cliShim, '..'), { recursive: true });
  writeFileSync(cliShim, `import(${JSON.stringify(pathToFileURL(resolve(root, 'node_modules/@openai/codex/bin/codex.js')).href)});`);
  const installedByScript = f.run('plugin.mjs', [], { CODESK_TEST_MCP_NAME: 'daily-desk', CODEX_HOME: profile });
  assert.equal(installedByScript.status, 0, installedByScript.stderr);
  const codex = args => spawnSync(process.execPath, [resolve(root, 'node_modules/@openai/codex/bin/codex.js'), ...args], {
    cwd: f.directory, encoding: 'utf8', env: { ...process.env, CODEX_HOME: profile },
  });
  const installSteps = [['plugin', 'marketplace', 'add', destination],
    ['plugin', 'add', `${manifest.name}@${marketplace.name}`]];
  for (const args of [...installSteps, ...installSteps]) {
    const installed = codex(args);
    assert.equal(installed.status, 0, installed.stderr);
  }
  const list = codex(['plugin', 'list', '--json']);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, new RegExp(marketplace.name));
  const mcp = codex(['mcp', 'list', '--json']);
  assert.equal(mcp.status, 0, mcp.stderr);
  assert.match(mcp.stdout, /https:\/\/my-desk\.actual-account\.workers\.dev\/mcp/);
  const nextConfig = { ...readJson(f.appConfigPath), pluginName: 'another-desk' };
  writeJson(f.appConfigPath, nextConfig);
  const renamed = f.run('plugin.mjs', ['--build-only']);
  assert.equal(renamed.status, 0, renamed.stderr);
  assert.ok(!existsSync(packagePath), 'Repackaging must remove stale plugin folders');
  assert.equal(readJson(resolve(destination, 'plugins/another-desk/.codex-plugin/plugin.json')).name, 'another-desk');
});
