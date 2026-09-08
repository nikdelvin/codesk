import { z } from 'zod';
import { handleMcp } from './mcp/server';
export { CoDesk } from './codesk';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/mcp') return handleMcp(request, env, ctx);
    const match = url.pathname.match(/^\/ws\/([a-f0-9-]{36})$/);
    if (match && z.uuid().safeParse(match[1]).success && !url.search) {
      return env.CODESK_DO.get(env.CODESK_DO.idFromName(match[1])).fetch(request);
    }
    if (url.pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
      return env.ASSETS.fetch(new Request('http://localhost/index.html', { method: request.method }));
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
