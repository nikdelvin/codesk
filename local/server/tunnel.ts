import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppError, privateDirectory } from './config'

export type TunnelOptions = { binary: string; dataDir: string; origin: string; workerPath: string; nodePath: string }
export type TunnelHandle = { origin: Promise<string>; exited: Promise<void>; close: () => Promise<void> }
export type TunnelFactory = (options: TunnelOptions) => TunnelHandle
export const spawnTunnel: TunnelFactory = options => {
  const directory = join(options.dataDir, 'tunnel'); privateDirectory(directory)
  const configuration = join(directory, 'quick.yml')
  writeFileSync(configuration, '{}\n', { mode: 0o600 })
  const child = spawn(options.nodePath, [options.workerPath, options.binary, configuration, options.origin], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  })
  let rejectOrigin: (error: Error) => void
  const origin = new Promise<string>((resolve, reject) => {
    rejectOrigin = reject
    child.on('message', message => {
      const url = (message as { origin?: unknown })?.origin
      if (typeof url === 'string' && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url)) resolve(url)
    })
  })
  const exited = new Promise<void>(resolve => {
    const finish = () => { rejectOrigin(new AppError('TUNNEL_UNAVAILABLE', 'cloudflared stopped. Run npm run diagnostics.')); resolve() }
    child.once('exit', finish); child.once('error', finish)
  })
  // The consumer may be shutting down before it awaits the origin promise.
  void origin.catch(() => {})
  return { origin, exited, close: async () => {
    if (child.connected) child.disconnect()
    await exited
  } }
}
