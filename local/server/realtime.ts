import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'
import { PROTOCOL_VERSION, SOCKET_PROTOCOL } from '../src/contracts/plugin'

export class Relay {
  server: WebSocketServer
  rooms = new Map<string, Set<WebSocket>>()
  capabilities = new Map<string, string>()
  changed: () => void
  constructor(http: Server, snapshot: (runId: string) => object, changed: () => void) {
    this.changed = changed
    this.server = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false,
      handleProtocols: () => SOCKET_PROTOCOL })
    http.on('upgrade', (request, socket, head) => {
      const match = request.url?.match(/^\/ws\/([a-f0-9-]{36})$/)
      const reject = (status: number) => { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`) }
      if (!match || !z.uuid().safeParse(match[1]).success) return reject(404)
      const runId = match[1], protocols = request.headers['sec-websocket-protocol']?.split(',').map(s => s.trim()) ?? []
      const capability = protocols.find(p => /^cap\.[A-Za-z0-9_-]{43}$/.test(p))?.slice(4)
      const saved = this.capabilities.get(runId)
      const hash = (value: string) => createHash('sha256').update(value).digest()
      if (!capability || !saved || !protocols.includes(SOCKET_PROTOCOL) || !timingSafeEqual(hash(capability), hash(saved))) return reject(401)
      if ((this.rooms.get(runId)?.size ?? 0) >= 4 || this.server.clients.size >= 64) return reject(429)
      let message: object
      try { message = snapshot(runId) } catch { return reject(410) }
      // There is no await between snapshot selection, subscription and send.
      this.server.handleUpgrade(request, socket, head, ws => {
        const room = this.rooms.get(runId) ?? new Set<WebSocket>()
        this.rooms.set(runId, room); room.add(ws)
        ws.on('error', () => ws.terminate())
        ws.on('close', () => { room.delete(ws); if (!room.size) this.rooms.delete(runId); changed() })
        ws.on('message', (data, binary) => {
          if (!binary && data.toString() === 'ping') { ws.send('pong'); return }
          ws.send(JSON.stringify({ schemaVersion: PROTOCOL_VERSION, type: 'error', code: 'INVALID_MESSAGE', message: 'Use MCP to update state.' }))
          ws.close(1008, 'Subscription only')
        })
        this.server.emit('connection', ws, request)
        ws.send(JSON.stringify(message)); changed()
      })
    })
  }
  capability(runId: string) {
    let value = this.capabilities.get(runId)
    if (!value) { value = randomBytes(32).toString('base64url'); this.capabilities.set(runId, value) }
    return value
  }
  publish(runId: string, message: object) {
    const encoded = JSON.stringify(message)
    for (const ws of this.rooms.get(runId) ?? []) {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 65536) { ws.terminate(); continue }
      ws.send(encoded, error => { if (error) ws.terminate() })
    }
  }
  closeRun(runId: string) {
    this.publish(runId, { schemaVersion: PROTOCOL_VERSION, type: 'error', code: 'RUN_DELETED', message: 'This saved run was deleted.' })
    for (const ws of this.rooms.get(runId) ?? []) ws.close(1008, 'Run deleted')
    this.capabilities.delete(runId)
  }
  disconnect() {
    this.capabilities.clear()
    for (const ws of this.server.clients) ws.terminate()
  }
  close() { this.disconnect(); this.server.close() }
}
