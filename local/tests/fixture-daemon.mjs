import { startDaemon, readSettings, AppError, spawnTunnel } from '../dist/library.mjs';
import { fakeTunnels } from './helpers.mjs';
const settings = readSettings(process.argv[3]);
try {
  await startDaemon(settings, { tunnelFactory: process.argv.includes('--real-watchdog') ? spawnTunnel : fakeTunnels().factory,
    probe: async () => {}, idleGraceMs: 1500, retryDelays: [10, 10, 10] });
} catch (error) {
  if (!(error instanceof AppError && error.code === 'RUNTIME_BUSY')) console.error(error);
  process.exitCode = error.code === 'RUNTIME_BUSY' ? 75 : 1;
}
