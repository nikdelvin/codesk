import worker, { CoDesk as ProductionCoDesk } from '../dist/worker/index.js';

export class CoDesk extends ProductionCoDesk {
  async getSnapshot(runId) {
    const snapshot = await super.getSnapshot(runId);
    const message = await this.ctx.storage.get('fixtureSnapshot');
    return snapshot && message ? { ...snapshot, message } : snapshot;
  }
  async fixture(action, message) {
    if (action === 'snapshot') await this.ctx.storage.put('fixtureSnapshot', message);
    if (action === 'broadcast') this.broadcast(message);
    const run = await this.ctx.storage.get('run');
    if (action === 'old') await this.ctx.storage.put('run', { snapshot: { runId: run.runId }, expiresAt: run.expiresAt });
    if (action === 'expire' || action === 'alarm') {
      await this.ctx.storage.put('run', { ...run, expiresAt: Date.now() - 1 });
      if (action === 'alarm') await this.ctx.storage.setAlarm(Date.now());
    }
    return this.ctx.storage.get('run');
  }
}
export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname !== '/__fixture') return worker.fetch(request, env, ctx);
    const { runId, action, message } = await request.json();
    const result = await env.CODESK_DO.get(env.CODESK_DO.idFromName(runId)).fixture(action, message);
    return Response.json(result ?? null);
  },
};
