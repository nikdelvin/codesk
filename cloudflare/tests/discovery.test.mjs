import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverApp } from '../scripts/mcp.mjs';

test('setup discovers an arbitrary MCP Apps UI without calling application tools', async () => {
  const uri = 'ui://workspace/dashboard.html';
  const resource = { uri, mimeType: 'text/html;profile=mcp-app', text: '<html>Workspace</html>' };
  const responses = {
    initialize: { serverInfo: { name: 'workspace' } },
    'tools/list': { tools: [{ name: 'search_notes' }, { name: 'show_dashboard', _meta: { ui: { resourceUri: uri } } }] },
    'resources/read': { contents: [resource] },
  };
  const methods = [];
  const rpc = async method => { methods.push(method); return responses[method]; };
  assert.deepEqual(await discoverApp(rpc, 'workspace'), resource);
  assert.deepEqual(methods, ['initialize', 'tools/list', 'resources/read']);
  await assert.rejects(discoverApp(rpc, 'another-plugin'), /different plugin name/);
  responses['tools/list'].tools = [{ name: 'search_notes' }];
  await assert.rejects(discoverApp(rpc, 'workspace'), /no UI resource/);
  responses['tools/list'].tools = [{ name: 'show_dashboard', _meta: { ui: { resourceUri: uri } } }];
  responses['resources/read'].contents = [{ ...resource, mimeType: 'application/json' }];
  await assert.rejects(discoverApp(rpc, 'workspace'), /not HTML/);
});
