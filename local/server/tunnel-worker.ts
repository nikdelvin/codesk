import { spawn } from 'node:child_process'

// This watchdog owns cloudflared. An IPC disconnect also fires when the daemon
// is killed abruptly, so a SIGKILL does not leave its tunnel behind.
const [binary, configuration, origin] = process.argv.slice(2)
const env: NodeJS.ProcessEnv = {}
for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'LANG']) {
  if (process.env[key]) env[key] = process.env[key]
}
const child = spawn(binary, ['tunnel', '--config', configuration, '--no-autoupdate',
  '--metrics', '127.0.0.1:0', '--management-diagnostics=false', '--grace-period', '1s',
  '--loglevel', 'info', '--url', origin], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
let stopping = false, found = false, buffer = ''
function stop() {
  if (stopping) return
  stopping = true; child.kill('SIGTERM')
  setTimeout(() => child.kill('SIGKILL'), 2000).unref()
}
function consume(data: Buffer) {
  buffer = (buffer + data.toString()).slice(-8192)
  const match = buffer.match(/https:\/\/([a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com)(?=[\s"/]|$)/)
  if (match && !found) { found = true; process.send?.({ origin: `https://${match[1]}` }) }
}
child.stdout.on('data', consume); child.stderr.on('data', consume)
child.on('error', () => { process.exitCode = 1; process.disconnect?.() })
child.on('exit', code => { process.exitCode = stopping ? 0 : code || 1; if (process.connected) process.disconnect() })
process.on('disconnect', stop)
process.on('SIGINT', stop); process.on('SIGTERM', stop)
