import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const root = resolve(import.meta.dirname, '..');
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export const configPath = resolve(root, 'wrangler.json');
export const appConfigPath = resolve(root, 'app.config.json');
export const readProject = () => {
  const { publicOrigin, pluginName } = readJson(appConfigPath);
  return { ...readJson(configPath), publicOrigin, pluginName };
};
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function validateConfig(config, requireAccount = false) {
  if (typeof config.pluginName !== 'string' || config.pluginName.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.pluginName)) {
    throw new Error('Plugin name must be 1–63 lowercase letters or digits separated by single hyphens. Run npm run configure.');
  }
  const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
  if (typeof config.name !== 'string' || !new RegExp(`^${label}$`).test(config.name)) throw new Error('Worker name must be 1–63 lowercase letters, digits or hyphens, with no leading/trailing hyphen.');
  if (!new RegExp(`^https://${config.name}\\.${label}\\.workers\\.dev$`).test(config.publicOrigin)
    && (requireAccount || config.publicOrigin !== 'https://example.invalid')) {
    throw new Error('publicOrigin must be https://<Worker name>.<your subdomain>.workers.dev. Run npm run configure.');
  }
  if ((requireAccount || config.account_id) && !/^[a-f0-9]{32}$/.test(config.account_id ?? '')) {
    throw new Error('A Cloudflare account ID is required. Run npm run cf:login, then npm run configure.');
  }
  return config;
}

// Invoke project-owned CLIs through Node, including on Windows (no shell quoting).
export function cli(tool, args, capture = false) {
  const entry = { wrangler: 'wrangler/bin/wrangler.js', codex: '@openai/codex/bin/codex.js' }[tool];
  const result = spawnSync(process.execPath, [resolve(root, 'node_modules', entry), ...args], {
    cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${tool} ${args[0]} failed (exit ${result.status}).`);
  return result.stdout;
}

export function accounts() {
  const result = JSON.parse(cli('wrangler', ['whoami', '--json'], true));
  if (!result.loggedIn || !result.accounts?.length) throw new Error('No Cloudflare account available. Run npm run cf:login.');
  return result.accounts;
}

export async function accountSubdomain(accountId) {
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error('Invalid Cloudflare account ID.');
  // Use Wrangler's supported credential command; never print or persist credentials.
  const auth = JSON.parse(cli('wrangler', ['auth', 'token', '--json'], true));
  const headers = auth.type === 'api_key'
    ? { 'X-Auth-Key': auth.key, 'X-Auth-Email': auth.email }
    : { Authorization: `Bearer ${auth.token}` };
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
    headers, signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok || !body.success || !body.result?.subdomain) {
    throw new Error(`Cannot read this account's workers.dev subdomain (HTTP ${response.status}). Check Wrangler permissions and register a subdomain in Cloudflare → Workers & Pages → Your subdomain, then rerun configure.`);
  }
  return body.result.subdomain;
}
