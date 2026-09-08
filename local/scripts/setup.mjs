import { join } from 'node:path';
import { configure } from './configure.mjs';
import { root, run } from './project.mjs';

try {
  await configure();
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
  run(process.execPath, [join(root, 'scripts/build.mjs')]);
  run(process.execPath, [join(root, 'scripts/verify-tunnel.mjs')]);
  run(process.execPath, [join(root, 'scripts/plugin.mjs')]);
} catch (error) { console.error(error.message); process.exitCode = 1; }
