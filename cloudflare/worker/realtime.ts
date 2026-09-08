import { DurableObject } from 'cloudflare:workers';
import { digest, PROTOCOL_VERSION, SOCKET_PROTOCOL } from '../src/contracts/plugin';

export const expired = () => ({ error: { code: 'RUN_EXPIRED', message: 'This session expired. Explicitly reopen the plugin.' } });

// Reusable transport: the application supplies an authorized session's current frame.
export abstract class WebSocketRelay extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  // Return undefined for missing, expired or incompatible sessions. Called inside the connection lock.
  protected abstract getSnapshot(runId: string): Promise<{ capabilityHash: string; message: object } | undefined>;

  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(value => value.trim()) ?? [];
    const capability = protocols.find(value => /^cap\.[A-Za-z0-9_-]{43}$/.test(value))?.slice(4);
    if (!capability || !protocols.includes(SOCKET_PROTOCOL)) return new Response('Unauthorized', { status: 401 });
    const hash = await digest(capability);
    return this.ctx.blockConcurrencyWhile(async () => {
      const snapshot = await this.getSnapshot(new URL(request.url).pathname.slice('/ws/'.length));
      if (!snapshot) return new Response('Run expired', { status: 410 });
      if (hash !== snapshot.capabilityHash) return new Response('Unauthorized', { status: 401 });
      if (this.ctx.getWebSockets().length >= 4) return new Response('Connection limit', { status: 429 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify(snapshot.message));
      return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': SOCKET_PROTOCOL } });
    });
  }
  protected broadcast(message: object) {
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(JSON.stringify(message)); } catch { this.webSocketError(socket); }
    }
  }
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    socket.send(JSON.stringify({ schemaVersion: PROTOCOL_VERSION, type: 'error', code: 'INVALID_MESSAGE', message: 'Use MCP to update the state.' }));
    socket.close(typeof message === 'string' && message.length <= 1024 ? 1008 : 1009, 'Subscription only');
  }
  webSocketClose(socket: WebSocket, code: number) { try { socket.close(code === 1005 ? 1000 : code); } catch { /* already closed */ } }
  webSocketError(socket: WebSocket) { try { socket.close(1011, 'Socket error'); } catch { /* already closed */ } }
  async alarm() {
    this.broadcast({ schemaVersion: PROTOCOL_VERSION, type: 'error', ...expired().error });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.close(1008, 'Run expired'); } catch { /* already closed */ }
    }
    await this.ctx.storage.deleteAll();
  }
}
