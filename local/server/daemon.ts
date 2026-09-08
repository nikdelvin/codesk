import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket, WebSocketServer } from 'ws'
import { ZodError } from 'zod'
import { atomicJson, AppError, metadataPath, privateDirectory, publicError, type Settings } from './config'
import { Store } from './storage'
import { Sessions, state } from './example'
import { Relay } from './realtime'
import { resource, renderView, viewUri } from './view'
import { spawnTunnel, type TunnelFactory, type TunnelHandle } from './tunnel'
import { PROTOCOL_VERSION } from '../src/contracts/plugin'

type Options = {
  directory?: string; tunnelFactory?: TunnelFactory; probe?: (origin: string, runtimeId: string) => Promise<void>
  idleGraceMs?: number; retryDelays?: number[]; readyTimeoutMs?: number; heartbeatMs?: number
}
export type RuntimeStatus = {
  installationId: string; runtimeId: string; buildHash: string; generation: string; resourceUri: string;
  phase: 'starting' | 'ready' | 'failed' | 'stopping'; origin: string | null; pid: number;
  clients: number; sockets: number; tunnelRestarts: number; error: string | null
}
export type RuntimeDescriptor = { installationId: string; runtimeId: string; buildHash: string; controlUrl: string; token: string }
const listen = (server: Server) => new Promise<string>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    server.off('error', reject)
    const address = server.address()
    if (address && typeof address === 'object') resolve(`http://127.0.0.1:${address.port}`)
  })
})
const closeServer = (server: Server) => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
const send = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value))
}
async function body(request: IncomingMessage): Promise<{ action: string; input?: unknown }> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 16384) throw new AppError('INVALID_MESSAGE', 'Request too large.')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()) }
  catch { throw new AppError('INVALID_MESSAGE', 'Invalid JSON request.') }
}
async function probe(origin: string, runtimeId: string) {
  const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(3000), redirect: 'error' })
  if (!response.ok || (await response.json()).runtimeId !== runtimeId) throw new Error('Tunnel not ready')
}

export async function startDaemon(settings: Settings, options: Options = {}) {
  privateDirectory(settings.dataDir)
  // A separate tiny coordination database holds an OS file lock for the entire
  // process lifetime. Never unlink it: SQLite releases the lock even on SIGKILL.
  const ownership = new DatabaseSync(join(settings.dataDir, 'runtime-lock.sqlite'))
  try { ownership.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;') }
  catch { ownership.close(); throw new AppError('RUNTIME_BUSY', 'Another runtime owns this installation.') }
  const directory = options.directory ?? import.meta.dirname
  let store: Store
  let html: string, buildHash: string
  try {
    html = readFileSync(join(directory, 'index.html'), 'utf8')
    buildHash = JSON.parse(readFileSync(join(directory, 'build.json'), 'utf8')).buildHash as string
    store = new Store(join(settings.dataDir, 'state.sqlite'))
  } catch (error) { ownership.close(); throw error }
  const runtimeId = randomUUID(), token = randomBytes(32).toString('base64url')
  let generation = randomUUID(), phase: RuntimeStatus['phase'] = 'starting', origin: string | null = null
  let tunnel: TunnelHandle | undefined, tunnelRestarts = 0, tunnelError: string | null = null
  let stopping = false, idle: ReturnType<typeof setTimeout> | undefined
  let closePromise: Promise<void> | undefined
  const uri = () => viewUri(settings.pluginName, buildHash, generation)
  const clientSockets = new WebSocketServer({ noServer: true, maxPayload: 1024 })
  const alive = new WeakSet<WebSocket>()
  const publicServer = createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { send(response, 404, { error: 'Not found' }); return }
    if (request.url === '/health') { send(response, 200, { runtimeId, generation }); return }
    if (request.url === '/' || request.url === '/index.html') {
      if (!origin || phase !== 'ready') { send(response, 503, { error: 'Tunnel is starting' }); return }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src ${origin} ${origin.replace('https:', 'wss:')};` })
      response.end(request.method === 'HEAD' ? undefined : renderView(html, origin, generation)); return
    }
    send(response, 404, { error: 'Not found' })
  })
  const updateIdle = () => {
    if (stopping) return
    if (clientSockets.clients.size || relay.server.clients.size) { clearTimeout(idle); idle = undefined }
    else if (!idle) idle = setTimeout(() => { void close() }, options.idleGraceMs ?? 60000)
  }
  const relay = new Relay(publicServer, runId => state(store.get(runId)), updateIdle)
  const sessions = new Sessions(store, (runId, message) => relay.publish(runId, message), runId => relay.closeRun(runId))
  const status = (): RuntimeStatus => ({ installationId: settings.installationId, runtimeId, buildHash,
    generation, resourceUri: uri(), phase, origin, pid: process.pid, clients: clientSockets.clients.size,
    sockets: relay.server.clients.size, tunnelRestarts, error: tunnelError })
  const notify = () => {
    for (const ws of clientSockets.clients) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(status()))
  }
  const authorized = (request: IncomingMessage) => {
    const value = request.headers.authorization ?? '', expected = `Bearer ${token}`
    const bytes = Buffer.from(value), expectedBytes = Buffer.from(expected)
    return bytes.length === expectedBytes.length && timingSafeEqual(bytes, expectedBytes)
  }
  async function ready() {
    const deadline = Date.now() + (options.readyTimeoutMs ?? 45000)
    while (phase === 'starting' && !stopping && Date.now() < deadline) await delay(50)
    if (phase !== 'ready' || !origin) throw new AppError('TUNNEL_UNAVAILABLE',
      'The HTTPS/WSS tunnel is unavailable. Check internet access and npm run diagnostics, then retry opening your saved run.')
    return origin
  }
  const controlServer = createServer((request, response) => {
    void (async () => {
      if (!authorized(request)) { send(response, 401, { error: 'Unauthorized' }); return }
      if (request.method === 'GET' && request.url === '/status') { send(response, 200, status()); return }
      if (request.method !== 'POST' || request.url !== '/rpc') { send(response, 404, { error: 'Not found' }); return }
      const { action, input = {} } = await body(request)
      let result: unknown
      switch (action) {
        case 'ready': await ready(); result = status(); break
        case 'view': {
          const publicOrigin = await ready()
          if ((input as { uri?: string }).uri !== uri()) throw new AppError('RESOURCE_STALE', 'This panel belongs to an older runtime. Start a fresh task and resume the saved run.')
          result = resource(html, uri(), publicOrigin, generation); break
        }
        case 'open': {
          const publicOrigin = await ready(), run = sessions.open(input)
          result = { run, resourceUri: uri(), bootstrap: { schemaVersion: PROTOCOL_VERSION, runId: run.run_id,
            socketUrl: `${publicOrigin.replace('https:', 'wss:')}/ws/${run.run_id}`, generation,
            capability: relay.capability(run.run_id) } }; break
        }
        case 'get': result = sessions.get(input); break
        case 'set': result = sessions.set(input); break
        case 'list': result = sessions.list(input); break
        case 'delete': result = sessions.delete(input); break
        case 'stop': send(response, 200, { ok: true, result: { stopped: true } }); setImmediate(() => void close()); return
        default: throw new AppError('INVALID_MESSAGE', 'Unknown local runtime action.')
      }
      send(response, 200, { ok: true, result })
    })().catch(error => send(response, 400, { ok: false, error: error instanceof ZodError
      ? { code: 'INVALID_MESSAGE', message: 'Invalid tool input.' } : publicError(error) }))
  })
  controlServer.on('upgrade', (request, socket, head) => {
    if (request.url !== '/clients' || !authorized(request) || clientSockets.clients.size >= 64 || stopping) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return
    }
    clientSockets.handleUpgrade(request, socket, head, ws => {
      alive.add(ws); ws.on('pong', () => alive.add(ws)); ws.on('error', () => ws.terminate())
      ws.on('message', () => ws.close(1008, 'Notifications only'))
      ws.on('close', updateIdle); updateIdle()
    })
  })
  relay.server.on('connection', ws => { alive.add(ws); ws.on('pong', () => alive.add(ws)) })
  const onSignal = () => { void close() }
  async function close() {
    if (closePromise) return closePromise
    stopping = true; phase = 'stopping'; clearTimeout(idle); clearInterval(heartbeat)
    closePromise = (async () => {
      process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal)
      relay.close()
      for (const ws of clientSockets.clients) ws.terminate()
      clientSockets.close()
      await tunnel?.close()
      await Promise.all([closeServer(publicServer), closeServer(controlServer)])
      try {
        const saved = JSON.parse(readFileSync(metadataPath(settings), 'utf8'))
        if (saved.runtimeId === runtimeId) unlinkSync(metadataPath(settings))
      } catch { /* Metadata may have been removed by the owner. */ }
      store.close(); ownership.close()
    })()
    return closePromise
  }
  const heartbeat = setInterval(() => {
    for (const ws of [...clientSockets.clients, ...relay.server.clients]) {
      if (!alive.has(ws)) ws.terminate()
      else { alive.delete(ws); ws.ping() }
    }
  }, options.heartbeatMs ?? 15000)
  let publicUrl: string, controlUrl: string
  try {
    publicUrl = await listen(publicServer); controlUrl = await listen(controlServer)
    atomicJson(metadataPath(settings), { installationId: settings.installationId, runtimeId, buildHash, controlUrl, token })
  } catch (error) { await close(); throw error }
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal)
  updateIdle()
  async function manageTunnel() {
    const backoffs = options.retryDelays ?? [1000, 2000, 4000]
    for (let attempt = 0; !stopping && attempt <= backoffs.length; attempt++) {
      if (attempt) {
        tunnelRestarts = attempt; generation = randomUUID(); phase = 'starting'; origin = null
        relay.disconnect(); notify()
        await delay(backoffs[attempt - 1])
        if (stopping) return
      }
      try {
        tunnel = (options.tunnelFactory ?? spawnTunnel)({ binary: settings.cloudflaredPath,
          dataDir: settings.dataDir, origin: publicUrl, workerPath: join(directory, 'tunnel-worker.mjs'), nodePath: settings.nodePath })
        const current = tunnel, deadline = Date.now() + (options.readyTimeoutMs ?? 45000)
        let exited = false
        void current.exited.then(() => { exited = true })
        const candidate = await Promise.race([current.origin, delay(Math.max(0, deadline - Date.now()), undefined, { ref: false }).then(() => { throw new Error('Tunnel startup timeout') })])
        let probed = false
        while (!stopping && !exited && Date.now() < deadline) {
          try { await (options.probe ?? probe)(candidate, runtimeId); probed = true; break }
          catch { await delay(250) }
        }
        if (stopping) { await current.close(); return }
        if (!probed || exited) throw new Error('Tunnel readiness failed')
        origin = candidate; phase = 'ready'; tunnelError = null; notify()
        await current.exited
        if (stopping) return
      } catch { /* Raw tunnel logs can contain headers; expose only sanitized status. */ }
      await tunnel?.close()
      tunnelError = 'cloudflared stopped or its public HTTPS health check failed.'
      phase = 'starting'; origin = null; relay.disconnect()
    }
    if (!stopping) { phase = 'failed'; notify() }
  }
  void manageTunnel().catch(() => { phase = 'failed'; tunnelError = 'Tunnel startup failed.'; notify() })
  return { status, close, ready, publicUrl, controlUrl }
}
