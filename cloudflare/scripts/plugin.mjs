import { cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { cli, readJson, readProject, root, validateConfig, writeJson } from './project.mjs';
import { mcpClient, discoverApp } from './mcp.mjs';
import { DISPLAY_NAME } from '../src/plugin/config.ts';

const { values } = parseArgs({ options: { 'build-only': { type: 'boolean' } } });
const { publicOrigin: origin, pluginName: name } = validateConfig(readProject(), !values['build-only']);
if (!values['build-only']) {
  await discoverApp(mcpClient(`${origin}/mcp`), name);
}
const marketplace = `codesk-${createHash('sha256').update(origin).digest('hex').slice(0, 12)}`;
const destination = resolve(root, '.plugin-build');
const plugin = resolve(destination, 'plugins', name);
rmSync(destination, { recursive: true, force: true });
cpSync(resolve(root, 'plugin'), plugin, { recursive: true });
cpSync(resolve(root, 'LICENSE'), resolve(plugin, 'LICENSE'));
const manifestPath = resolve(plugin, '.codex-plugin/plugin.json');
const manifest = readJson(manifestPath);
manifest.name = name;
manifest.interface.displayName = DISPLAY_NAME;
manifest.interface.defaultPrompt[0] = `Open ${DISPLAY_NAME}`;
manifest.version = `${manifest.version.split('+')[0]}+codex.${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
manifest.mcpServers = './.mcp.json';
writeJson(manifestPath, manifest);
writeJson(resolve(plugin, '.mcp.json'), { mcpServers: {
  [marketplace]: { type: 'http', url: `${origin}/mcp` },
} });
writeJson(resolve(destination, '.agents/plugins/marketplace.json'), {
  name: marketplace, interface: { displayName: `${DISPLAY_NAME} (${new URL(origin).hostname})` },
  plugins: [{ name, source: { source: 'local', path: `./plugins/${name}` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
});
console.log(`Packaged ${name}@${marketplace}: ${origin}/mcp`);
if (!values['build-only']) {
  cli('codex', ['plugin', 'marketplace', 'add', destination]);
  cli('codex', ['plugin', 'add', `${name}@${marketplace}`]);
  console.log(`Installed. Fully quit and reopen Codex, then start a new task and ask: Open ${DISPLAY_NAME}.`);
}
