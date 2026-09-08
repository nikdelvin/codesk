import { build as vite } from 'vite';
import { build as esbuild } from 'esbuild';
import { isBuiltin } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { designAssets } from './ui-assets.mjs';

process.chdir(resolve(import.meta.dirname, '..'));
await vite();
const html = await readFile('dist/index.html', 'utf8');
if (!html.includes('<!--CODESK_RUNTIME-->') || /<script\b[^>]*\bsrc=|<link\b/i.test(html)
  || /(?:src|href)=["']\/assets\//.test(html)) {
  throw new Error('The UI must inline application JS/CSS and preserve its runtime slot.');
}
for (const entry of ['stdio', 'daemon', 'tunnel-worker', 'library']) {
  const result = await esbuild({ entryPoints: [`server/${entry === 'daemon' ? 'daemon-main' : entry}.ts`], outfile: `dist/${entry}.mjs`,
    bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true,
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    define: { 'process.env.WS_NO_BUFFER_UTIL': '"1"', 'process.env.WS_NO_UTF_8_VALIDATE': '"1"' },
    plugins: [{ name: 'omit-optional-native-addons', setup(build) {
      build.onResolve({ filter: /^(bufferutil|utf-8-validate)$/ }, args => ({ path: args.path, namespace: 'optional-addon' }));
      build.onLoad({ filter: /.*/, namespace: 'optional-addon' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
    } }],
  });
  const externals = Object.values(result.metafile.outputs).flatMap(output => output.imports).filter(item => item.external && !isBuiltin(item.path));
  if (externals.length) throw new Error(`Runtime has external dependencies: ${externals.map(item => item.path).join(', ')}`);
}
const assetManifest = {};
for (const asset of designAssets(process.cwd())) {
  const bytes = await readFile(`dist/${asset.path}`);
  if (!bytes.equals(asset.bytes)) throw new Error(`Packaged asset changed: ${asset.path}`);
  assetManifest[asset.path] = { bytes: bytes.length, sha256: asset.sha256 };
  if (!html.includes(asset.path)) throw new Error(`UI does not reference ${asset.path}`);
}
await writeFile('dist/ui-assets.json', JSON.stringify(assetManifest, null, 2) + '\n');
const files = {};
async function inventory(directory = '') {
  for (const entry of await readdir(`dist/${directory}`, { withFileTypes: true })) {
    const name = directory + entry.name;
    if (entry.isDirectory()) await inventory(name + '/');
    else {
      if (!['index.html', 'stdio.mjs', 'daemon.mjs', 'tunnel-worker.mjs', 'library.mjs', 'ui-assets.json'].includes(name) && !assetManifest[name]) throw new Error(`Unexpected packaged file: ${name}`);
      const bytes = await readFile(`dist/${name}`);
      files[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
  }
}
await inventory();
const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
const buildHash = createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
const { pluginName } = JSON.parse(await readFile('app.config.json', 'utf8'));
await writeFile('dist/build.json', JSON.stringify({ buildHash, pluginName, files: ordered }, null, 2) + '\n');
console.log(`Built local runtime ${buildHash.slice(0, 12)} with four verified UI assets.`);
