import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { codex, pluginName, readJson, root, settings, writeJson } from './project.mjs';
import { inspectRuntime, request } from '../dist/library.mjs';
import { setTimeout as delay } from 'node:timers/promises';

export function packagePlugin(destination, config, previousVersion) {
  const name = pluginName(config.pluginName), build = readJson(join(root, 'dist/build.json'));
  if (build.pluginName !== name) throw new Error('Plugin identity changed since the build. Run npm run build.');
  mkdirSync(destination, { recursive: true });
  cpSync(join(root, 'plugin'), destination, { recursive: true });
  cpSync(join(root, 'dist'), join(destination, 'dist'), { recursive: true });
  cpSync(join(root, 'LICENSE'), join(destination, 'LICENSE'));
  const manifest = readJson(join(destination, '.codex-plugin/plugin.json'));
  const displayName = name === 'codesk-local' ? 'CoDesk Local' : name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' ');
  let stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const prior = previousVersion?.match(/\+codex\.(\d{14})$/)?.[1];
  if (prior && stamp <= prior) {
    stamp = new Date(Date.UTC(+prior.slice(0, 4), +prior.slice(4, 6) - 1, +prior.slice(6, 8), +prior.slice(8, 10), +prior.slice(10, 12), +prior.slice(12, 14) + 1))
      .toISOString().replace(/\D/g, '').slice(0, 14);
  }
  manifest.name = name; manifest.version = `${manifest.version.split('+')[0]}+codex.${stamp}`;
  manifest.interface.displayName = displayName; manifest.interface.defaultPrompt = [`Open ${displayName}`];
  writeJson(join(destination, '.codex-plugin/plugin.json'), manifest);
  writeJson(join(destination, 'runtime-settings.json'), config);
  writeJson(join(destination, 'codesk-local-install.json'), { installationId: config.installationId, source: root });
  writeLaunchMapping(destination, config);
  return manifest;
}
export function writeLaunchMapping(destination, config) {
  writeJson(join(destination, '.mcp.json'), { mcpServers: { [config.pluginName]: {
    command: config.nodePath, args: [join(destination, 'dist/stdio.mjs'), join(destination, 'runtime-settings.json')],
  } } });
}
export function marketplaceEntry(path, name) {
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const marketplace = before ? JSON.parse(before) : { name: 'personal', interface: { displayName: 'Personal' }, plugins: [] };
  if (!/^[A-Za-z0-9_-]+$/.test(marketplace.name ?? '') || !Array.isArray(marketplace.plugins)) throw new Error('Invalid personal marketplace. No entries were changed.');
  const existing = marketplace.plugins.find(item => item.name === name);
  if (existing && (existing.source?.source !== 'local' || existing.source?.path !== `./plugins/${name}`)) {
    throw new Error('This plugin name already belongs to another source. Configure a different name.');
  }
  if (!existing) {
    marketplace.plugins.push({ name, source: { source: 'local', path: `./plugins/${name}` },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' });
  }
  return { name: marketplace.name, save: () => {
    if (existing) return; // Reinstall never rewrites existing marketplace entries.
    const latest = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (latest !== before) throw new Error('The marketplace changed during installation. Rerun plugin:install.');
    writeJson(path, marketplace);
  } };
}
export async function installPlugin({ buildOnly = false, userDirectory = homedir(), invokeCodex = codex,
  config = settings(), stagingRoot = join(root, '.plugin-build') } = {}) {
  const name = config.pluginName;
  const destination = join(userDirectory, 'plugins', name);
  const stage = join(stagingRoot, 'plugins', name);
  const manifestPath = join(destination, '.codex-plugin/plugin.json');
  let previousVersion;
  if (!buildOnly && existsSync(destination)) {
    const marker = join(destination, 'codesk-local-install.json');
    if (!existsSync(marker) || readJson(marker).installationId !== config.installationId) throw new Error('The destination belongs to another plugin installation. Choose a different name.');
    previousVersion = readJson(manifestPath).version;
  }
  const marketplace = buildOnly ? null : marketplaceEntry(join(userDirectory, '.agents/plugins/marketplace.json'), name);
  rmSync(stage, { recursive: true, force: true });
  const manifest = packagePlugin(stage, config, previousVersion);
  if (buildOnly) { console.log(`Packaged ${manifest.name}@${manifest.version}: ${stage}`); return stage; }
  const running = await inspectRuntime(config);
  if (running) {
    await request(running.descriptor, 'stop');
    const deadline = Date.now() + 10000;
    while (await inspectRuntime(config)) {
      if (Date.now() > deadline) throw new Error('Runtime shutdown timed out. The installed plugin was not replaced.');
      await delay(100);
    }
  }
  mkdirSync(dirname(destination), { recursive: true });
  const backup = `${destination}.previous`;
  if (existsSync(backup)) throw new Error(`A previous installation backup exists at ${backup}. Inspect it before retrying.`);
  if (existsSync(destination)) renameSync(destination, backup);
  try {
    cpSync(stage, destination, { recursive: true }); writeLaunchMapping(destination, config);
    marketplace.save(); invokeCodex(['plugin', 'add', `${name}@${marketplace.name}`]);
  } catch (error) {
    if (existsSync(backup)) { rmSync(destination, { recursive: true, force: true }); renameSync(backup, destination); }
    throw error;
  }
  rmSync(backup, { recursive: true, force: true });
  console.log(`Installed ${name}@${marketplace.name}. Fully quit and reopen Codex, start a fresh task, and ask: Open ${manifest.interface.displayName}.`);
  return destination;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'build-only': { type: 'boolean' } } });
  installPlugin({ buildOnly: values['build-only'] }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
