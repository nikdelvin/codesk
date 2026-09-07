import { DurableObject } from 'cloudflare:workers';
import { digest, mutationInput, PROTOCOL_VERSION, type StateMessage } from '../src/contracts/plugin';

type Receipt = { run_id: string; value: number; revision: number };
type SavedRun = { schemaVersion: number; runId: string; value: number; revision: number;
  capabilityHash: string; expiresAt: number; operations: Map<string, Receipt> };
const expired = () => ({ error: { code: 'RUN_EXPIRED', message: 'This session expired. Explicitly reopen the plugin.' } });
const state = (run: SavedRun): StateMessage => ({ schemaVersion: PROTOCOL_VERSION, type: 'state',
  runId: run.runId, value: run.value, revision: run.revision });
const summary = (run: SavedRun) => ({ run_id: run.runId, value: run.value, revision: run.revision,
  expiresAt: new Date(run.expiresAt).toISOString() });

export class CoDesk extends DurableObject<Env> {
  private async read(runId: string) {
    const run = await this.ctx.storage.get<SavedRun>('run');
    return run?.schemaVersion === PROTOCOL_VERSION && run.runId === runId && run.expiresAt > Date.now() ? run : undefined;
  }
  async open(runId: string, capabilityHash: string) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (await this.ctx.storage.get('run')) throw new Error('Run already initialized');
      const run: SavedRun = { schemaVersion: PROTOCOL_VERSION, runId, value: 0, revision: 0,
        capabilityHash, expiresAt: Date.now() + 60 * 60 * 1000, operations: new Map() };
      await this.ctx.storage.put('run', run);
      await this.ctx.storage.setAlarm(run.expiresAt);
      return summary(run);
    });
  }
  async set(input: unknown) {
    const parsed = mutationInput.safeParse(input);
    if (!parsed.success) return { error: { code: 'INVALID_MESSAGE', message: 'Invalid state mutation.' } };
    const { run_id, value, operation_id } = parsed.data;
    return this.ctx.blockConcurrencyWhile(async () => {
      const run = await this.read(run_id);
      if (!run) return expired();
      const previous = run.operations.get(operation_id);
      if (previous) return previous.value === value ? { ...previous, duplicate: true }
        : { error: { code: 'OPERATION_CONFLICT', message: 'This operation ID was already used with another value.' } };
      if (run.operations.size >= 256) return { error: { code: 'OPERATION_LIMIT', message: 'This session reached 256 mutations. Explicitly reopen the plugin.' } };
      const receipt = { run_id, value, revision: run.revision + 1 };
      run.value = value;
      run.revision = receipt.revision;
      run.operations.set(operation_id, receipt);
      await this.ctx.storage.put('run', run);
      this.broadcast(state(run));
      return { ...receipt, duplicate: false };
    });
  }
  async inspect(runId: string) {
    const run = await this.read(runId);
    return run ? summary(run) : expired();
  }
  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(value => value.trim()) ?? [];
    const capability = protocols.find(value => /^cap\.[A-Za-z0-9_-]{43}$/.test(value))?.slice(4);
    if (!capability || !protocols.includes('codesk.ws')) return new Response('Unauthorized', { status: 401 });
    const hash = await digest(capability);
    return this.ctx.blockConcurrencyWhile(async () => {
      const run = await this.read(new URL(request.url).pathname.slice('/ws/'.length));
      if (!run) return new Response('Run expired', { status: 410 });
      if (hash !== run.capabilityHash) return new Response('Unauthorized', { status: 401 });
      if (this.ctx.getWebSockets().length >= 4) return new Response('Connection limit', { status: 429 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify(state(run)));
      return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'codesk.ws' } });
    });
  }
  private broadcast(message: object) {
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(JSON.stringify(message)); } catch { this.webSocketError(socket); }
    }
  }
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === 'ping') { socket.send('pong'); return; }
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
