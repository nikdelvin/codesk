import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve, join, delimiter, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const root = resolve(import.meta.dirname, '..');
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export const settingsPath = join(root, '.local/settings.json');
export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}
export function pluginName(value) {
  if (typeof value !== 'string' || value.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error('Use 1–63 lowercase letters or digits separated by single hyphens for the plugin name.');
  }
  return value;
}
export function defaultDataDir(name) {
  const base = process.platform === 'darwin' ? join(homedir(), 'Library/Application Support')
    : process.platform === 'win32' ? process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local')
    : process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share');
  return resolve(base, 'codesk', pluginName(name));
}
export function executable(name) {
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = resolve(directory, name + extension);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ''} failed (exit ${result.status}).`);
  return result.stdout;
}
export const codex = args => run(process.execPath, [join(root, 'node_modules/@openai/codex/bin/codex.js'), ...args]);
export function settings() {
  if (!existsSync(settingsPath)) throw new Error('Run npm run configure first.');
  const config = readJson(settingsPath);
  pluginName(config.pluginName);
  if (![config.nodePath, config.cloudflaredPath, config.dataDir].every(value => typeof value === 'string' && isAbsolute(value))) {
    throw new Error('Invalid runtime paths. Run npm run configure again.');
  }
  return config;
}
