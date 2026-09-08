import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { defaultDataDir, pluginName, readJson, root, settingsPath, writeJson, run } from './project.mjs';
import { locateCloudflared } from './cloudflared.mjs';

export async function configure(args = process.argv.slice(2)) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or later is required.');
  const { values } = parseArgs({ args, options: {
    'plugin-name': { type: 'string' }, 'data-dir': { type: 'string' }, cloudflared: { type: 'string' }, yes: { type: 'boolean' },
  } });
  const previous = existsSync(settingsPath) ? readJson(settingsPath) : null;
  let name = values['plugin-name'] ?? readJson(join(root, 'app.config.json')).pluginName;
  if (!values['plugin-name'] && !values.yes && process.stdin.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { name = (await prompt.question(`Plugin name [${name}]: `)).trim() || name; } finally { prompt.close(); }
  }
  pluginName(name);
  const dataDir = values['data-dir'] ? resolve(values['data-dir'])
    : previous?.pluginName === name ? previous.dataDir : defaultDataDir(name);
  const identityPath = join(dataDir, 'installation.json');
  const identity = existsSync(identityPath) ? readJson(identityPath) : { pluginName: name, installationId: randomUUID() };
  if (identity.pluginName !== name) throw new Error('That data directory belongs to another plugin. Choose another --data-dir.');
  const binary = await locateCloudflared(dataDir, values.cloudflared ?? (previous?.pluginName === name ? previous.cloudflaredPath : undefined));
  run(process.execPath, ['-e', 'require("node:sqlite")'], { stdio: 'pipe' });
  const config = { pluginName: name, installationId: identity.installationId, dataDir, cloudflaredPath: binary, nodePath: process.execPath };
  writeJson(identityPath, identity); writeJson(settingsPath, config);
  writeJson(join(root, 'app.config.json'), { pluginName: name });
  console.log(`Configured ${name}. Saved data: ${dataDir}`);
  return config;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  configure().catch(error => { console.error(error.message); process.exitCode = 1; });
}
