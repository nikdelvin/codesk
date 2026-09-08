import { build as vite } from 'vite';
import { build as esbuild } from 'esbuild';
import { isBuiltin } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

process.chdir(resolve(import.meta.dirname, '..'));
await vite();
const html = await readFile('dist/index.html', 'utf8');
if (!html.includes('<!--CODESK_RUNTIME-->') || /<script\b[^>]*\bsrc=|<link\b/i.test(html)
  || /(?:src|href)=["']\/assets\//.test(html) || (await readdir('dist')).join(',') !== 'index.html') {
  throw new Error('The UI must be self-contained HTML with its runtime slot intact.');
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
const files = {};
for (const name of (await readdir('dist')).sort()) {
  const bytes = await readFile(`dist/${name}`);
  files[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const buildHash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
const { pluginName } = JSON.parse(await readFile('app.config.json', 'utf8'));
await writeFile('dist/build.json', JSON.stringify({ buildHash, pluginName, files }, null, 2) + '\n');
console.log(`Built local runtime ${buildHash.slice(0, 12)} and self-contained UI.`);
