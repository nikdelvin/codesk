import { parseArgs } from 'node:util';
import { accounts, accountSubdomain, cli, readProject, validateConfig } from './project.mjs';

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' } } });
const dryRun = values['dry-run'];
const config = validateConfig(readProject(), !dryRun);
if (!dryRun && !accounts().some(account => account.id === config.account_id)) {
  throw new Error('Wrangler is logged into a different account. Run npm run cf:login for the configured account, or npm run configure for a new deployment.');
}
if (!dryRun && config.publicOrigin !== `https://${config.name}.${await accountSubdomain(config.account_id)}.workers.dev`) {
  throw new Error('publicOrigin does not match the account’s real workers.dev URL. Run npm run configure and deploy again.');
}
// The npm deploy script builds first, producing .wrangler/deploy/config.json.
cli('wrangler', ['deploy', ...(dryRun ? ['--dry-run'] : [])]);
if (!dryRun) await import('./verify-deployed.mjs');
