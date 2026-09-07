export function mcpClient(url, send = fetch) {
  let id = 0;
  return async (method, params = {}) => {
    const response = await send(url, { method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    const body = await response.text();
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${body}`);
    const envelope = response.headers.get('Content-Type')?.includes('text/event-stream')
      ? JSON.parse(body.split('\n').find(line => line.startsWith('data: ')).slice(6)) : JSON.parse(body);
    if (envelope.error) throw new Error(JSON.stringify(envelope.error));
    return envelope.result;
  };
}

// Deployment and installation depend on MCP Apps discovery, not application tool names.
export async function discoverApp(rpc, expectedName) {
  const initialized = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'codesk-check', version: '1' } });
  if (initialized.serverInfo?.name !== expectedName) throw new Error('The deployed app uses a different plugin name. Run npm run deploy before installing.');
  const { tools } = await rpc('tools/list');
  const uri = tools?.find(tool => typeof tool._meta?.ui?.resourceUri === 'string')?._meta.ui.resourceUri;
  if (!uri) throw new Error('The MCP endpoint has no UI resource. Run npm run deploy before installing.');
  const { contents } = await rpc('resources/read', { uri });
  const resource = contents?.find(item => item.uri === uri && item.mimeType?.startsWith('text/html') && typeof item.text === 'string' && item.text.trim());
  if (!resource) throw new Error('The MCP UI resource is unavailable or is not HTML.');
  return resource;
}

export async function eventually(check, message = 'Expected state did not arrive') {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(message);
}
