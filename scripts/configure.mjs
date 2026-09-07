import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { accounts, accountSubdomain, appConfigPath, configPath, readProject, validateConfig, writeJson } from './project.mjs';

const { values } = parseArgs({ options: {
  'plugin-name': { type: 'string' }, name: { type: 'string' }, account: { type: 'string' },
} });
const config = readProject();
const available = accounts();
const input = createInterface({ input: process.stdin, output: process.stdout });
async function ask(value, label) {
  if (value) return value.trim();
  if (!process.stdin.isTTY) throw new Error(`${label} is required. Pass --plugin-name and (for multiple accounts) --account.`);
  return (await input.question(`${label}: `)).trim();
}

try {
  const accountId = values.account ?? (available.length === 1 ? available[0].id : undefined);
  if (!accountId) console.log(available.map(account => `${account.id}  ${account.name}`).join('\n'));
  const id = await ask(accountId, 'Cloudflare account ID');
  if (!available.some(account => account.id === id)) throw new Error('The selected account is not accessible to this Wrangler login.');
  const selectedName = await ask(values['plugin-name'], 'Plugin name (for example my-desk)');
  const name = values.name?.trim() ?? selectedName;
  const subdomain = await accountSubdomain(id);
  const { publicOrigin, pluginName, ...worker } = validateConfig({ ...config, name, pluginName: selectedName, account_id: id,
    publicOrigin: `https://${name}.${subdomain}.workers.dev`,
  }, true);
  writeJson(configPath, worker);
  writeJson(appConfigPath, { publicOrigin, pluginName });
  console.log(`Configured plugin ${pluginName} at ${publicOrigin}. Next: npm run deploy`);
} finally {
  input.close();
}
