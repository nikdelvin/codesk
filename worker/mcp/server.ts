import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { digest, mutationInput, newCapability, runInput, PROTOCOL_VERSION } from '../../src/contracts/plugin';
import { DISPLAY_NAME, PLUGIN_NAME, PUBLIC_ORIGIN, SOCKET_ORIGIN } from '../../src/plugin/config';
import { readView } from './view';

const VERSION = String(PROTOCOL_VERSION);

function result(data: object) {
  if ('error' in data) return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(data.error) }] };
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data };
}
export async function createServer(env: Env) {
  const view = await readView(env).catch(() => undefined);
  const resourceUri = view?.uri;
  const server = new McpServer({ name: PLUGIN_NAME, version: VERSION });
  const socketOrigin = SOCKET_ORIGIN;
  if (view) server.registerResource('plugin-view', view.uri, { title: DISPLAY_NAME, mimeType: 'text/html;profile=mcp-app' }, async () => ({
    contents: [{ uri: view.uri, mimeType: 'text/html;profile=mcp-app', text: view.html,
      _meta: { ui: { prefersBorder: true, csp: { resourceDomains: [PUBLIC_ORIGIN], connectDomains: [PUBLIC_ORIGIN, socketOrigin] } } } }],
  }));
  server.registerTool('open_plugin', {
    title: `Open ${DISPLAY_NAME}`, description: 'Explicitly open one new one-hour plugin session and its React view. Save run_id. Never reopen to display a mutation.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    ...(resourceUri ? { _meta: { ui: { resourceUri } } } : {}),
  }, async () => {
    if (!view) return result({ error: { code: 'VIEW_UNAVAILABLE', message: 'The current UI is unavailable. Check the application build.' } });
    const runId = crypto.randomUUID(), capability = newCapability();
    const room = env.CODESK_DO.get(env.CODESK_DO.idFromName(runId));
    const opened = await room.open(runId, await digest(capability));
    return { ...result(opened), _meta: { 'codesk/bootstrap': { schemaVersion: PROTOCOL_VERSION,
      runId, socketUrl: `${socketOrigin}/ws/${runId}`, capability, expiresAt: opened.expiresAt } } };
  });
  server.registerTool('set_state', { title: 'Set State',
    description: 'Set the example state value from -999 to 999 and broadcast the committed revision. Reuse operation_id only when retrying the same change. Does not reopen the view.',
    inputSchema: mutationInput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => result(await env.CODESK_DO.get(env.CODESK_DO.idFromName(input.run_id)).set(input)));
  server.registerTool('get_state', { title: 'Inspect State',
    description: 'Inspect the persisted state, revision and expiration. Never poll this tool to update the UI; state must arrive via WebSocket.',
    inputSchema: runInput, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ run_id }) => result(await env.CODESK_DO.get(env.CODESK_DO.idFromName(run_id)).inspect(run_id)));
  return server;
}
export function handleMcp(request: Request, env: Env, ctx: ExecutionContext) {
  return createMcpHandler(() => createServer(env))(request, env, ctx);
}
