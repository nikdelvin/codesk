import { join } from 'node:path'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import { mutationInput } from '../src/example'
import { listInput, openInput, runInput, PROTOCOL_VERSION } from '../src/contracts/plugin'
import { connectRuntime } from './runtime-client'
import { readSettings, publicError } from './config'
import type { Run } from './storage'

function result(data: object): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: { ...data } }
}
async function main() {
  // The default is relative to the installed bundle, never the host's cwd.
  const settingsPath = process.argv[2] ?? join(import.meta.dirname, '..', 'runtime-settings.json')
  const settings = readSettings(settingsPath)
  const runtime = await connectRuntime(settingsPath)
  let current = runtime.status
  const server = new McpServer({ name: settings.pluginName, version: String(PROTOCOL_VERSION) })
  server.registerResource('plugin-view', new ResourceTemplate(`ui://${settings.pluginName}/app/{build}/{generation}/index.html`, {
    list: async () => ({ resources: [{ name: 'plugin-view', uri: current.resourceUri, mimeType: 'text/html;profile=mcp-app' }] }),
  }), { title: settings.pluginName, mimeType: 'text/html;profile=mcp-app' }, async url => {
    try { return await runtime.call<ReadResourceResult>('view', { uri: url.href }) }
    catch (error) { throw new McpError(ErrorCode.InvalidParams, publicError(error).message) }
  })
  const guarded = async (work: () => Promise<CallToolResult>): Promise<CallToolResult> => {
    try { return await work() } catch (error) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(publicError(error)) }] }
    }
  }
  const opened = server.registerTool('open_plugin', {
    title: 'Open Local Plugin', description: 'Explicitly open a new persisted run, or resume a saved run by run_id. Save run_id. Never reopen to show a mutation.',
    inputSchema: openInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: current.resourceUri } },
  }, input => guarded(async () => {
    const data = await runtime.call<{ run: Run; bootstrap: object; resourceUri: string }>('open', input)
    return { ...result(data.run), _meta: { 'codesk/bootstrap': data.bootstrap, ui: { resourceUri: data.resourceUri } } }
  }))
  server.registerTool('set_state', {
    title: 'Set State', description: 'Set the example counter from -999 to 999 and broadcast its committed revision. Reuse operation_id only to retry the identical change. Does not reopen the panel.',
    inputSchema: mutationInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, input => guarded(async () => result(await runtime.call('set', input))))
  server.registerTool('get_state', {
    title: 'Inspect State', description: 'Inspect a saved run and its revision. Never poll this tool to update the UI; the UI receives WebSocket state.',
    inputSchema: runInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, input => guarded(async () => result(await runtime.call('get', input))))
  server.registerTool('list_runs', {
    title: 'List Saved Runs', description: 'List saved runs, newest updated first. Use the returned cursor for another page. Runs remain until explicitly deleted.',
    inputSchema: listInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, input => guarded(async () => result(await runtime.call('list', input))))
  server.registerTool('delete_run', {
    title: 'Delete Saved Run', description: 'Permanently delete one run and all its operation receipts, closing its panels. Use only when the user explicitly requests deletion.',
    inputSchema: runInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, input => guarded(async () => result(await runtime.call('delete', input))))
  runtime.onStatus(status => {
    if (current.resourceUri !== status.resourceUri) {
      opened.update({ _meta: { ui: { resourceUri: status.resourceUri } } })
      server.server.sendResourceListChanged()
    }
    current = status
  })
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await runtime.close(); await server.close(); process.stdin.pause()
  }
  process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close())
  process.stdin.once('end', () => void close()); runtime.ws.once('close', () => void close())
  await server.connect(new StdioServerTransport())
  server.server.onclose = () => { void close() }
}
main().catch(error => { console.error(JSON.stringify(publicError(error))); process.exitCode = 1 })
