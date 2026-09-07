import { digest } from '../../src/contracts/plugin';
import { UI_PATH, resourceUri } from '../../src/plugin/config';

export async function readView(env: Env) {
  // ASSETS matches the pathname. Localhost also passes Vite's dev host check.
  const response = await env.ASSETS.fetch(new Request(new URL(UI_PATH, 'http://localhost'), {
    redirect: 'manual', signal: AbortSignal.timeout(5000),
  }));
  if (response.status !== 200 || !response.headers.get('Content-Type')?.includes('text/html') || !response.body) {
    throw new Error(`UI unavailable (HTTP ${response.status})`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 256000) throw new Error('UI too large');
  const html = new TextDecoder().decode(bytes);
  if (!html.includes('name="codesk-ui" content="app"')) {
    throw new Error('Unexpected UI document');
  }
  // Vite's HTML references hashed JS/CSS/assets, so their changes also change
  // this MCP cache key. Read the current binding each time; no isolate cache.
  const hash = await digest(html);
  return { html, hash, uri: resourceUri(hash) };
}
