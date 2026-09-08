import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { executable, readJson, root, run } from './project.mjs';

export function verifyDigest(bytes, expected) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('cloudflared download checksum mismatch. Nothing was installed.');
}
export async function locateCloudflared(dataDir, explicit) {
  const found = explicit ? resolve(explicit) : executable('cloudflared');
  if (found) { run(found, ['--version'], { stdio: 'pipe' }); return found; }
  const release = readJson(join(root, 'scripts/cloudflared-release.json'));
  const artifact = release.platforms[`${process.platform}-${process.arch}`];
  if (!artifact) throw new Error('Install cloudflared for this platform, then run configure with --cloudflared /absolute/path.');
  const directory = join(dataDir, 'bin', release.version);
  const destination = join(directory, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  const receiptPath = `${destination}.sha256`;
  if (existsSync(destination) && existsSync(receiptPath)) {
    verifyDigest(readFileSync(destination), readFileSync(receiptPath, 'utf8').trim());
    run(destination, ['--version'], { stdio: 'pipe' }); return destination;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  console.log(`Downloading cloudflared ${release.version} for ${process.platform}/${process.arch}…`);
  const response = await fetch(artifact.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`cloudflared download failed (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyDigest(bytes, artifact.sha256);
  const temporary = join(directory, 'download.tmp');
  writeFileSync(temporary, bytes, { mode: 0o600 });
  try {
    if (artifact.name.endsWith('.tgz')) {
      // The archive is pinned and verified before extraction.
      run('tar', ['-xzf', temporary, '-C', directory, 'cloudflared']);
    } else renameSync(temporary, destination);
    chmodSync(destination, 0o700);
    run(destination, ['--version'], { stdio: 'pipe' });
    writeFileSync(receiptPath, createHash('sha256').update(readFileSync(destination)).digest('hex') + '\n', { mode: 0o600 });
    return destination;
  } finally { rmSync(temporary, { force: true }); }
}
