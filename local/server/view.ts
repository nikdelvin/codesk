import { AppError } from './config'

export function viewUri(name: string, hash: string, generation: string) {
  return `ui://${name}/app/${hash}/${generation}/index.html`
}
export function renderView(html: string, origin: string, generation: string) {
  if (!html.includes('<!--CODESK_RUNTIME-->')) throw new AppError('VIEW_UNAVAILABLE', 'Rebuild the local UI before opening it.')
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) throw new AppError('VIEW_UNAVAILABLE', 'Invalid runtime origin.')
  const data = JSON.stringify({ socketOrigin: origin.replace('https:', 'wss:'), generation }).replaceAll('<', '\\u003c')
  return html.replaceAll('https://codesk-assets.invalid', origin).replace('<!--CODESK_RUNTIME-->', `<script type="application/json" id="codesk-runtime">${data}</script>`)
}
export function resource(html: string, uri: string, origin: string, generation: string) {
  const connectDomains = [origin, origin.replace('https:', 'wss:')]
  return { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: renderView(html, origin, generation),
    _meta: { ui: { prefersBorder: true, csp: { resourceDomains: [origin], connectDomains } },
      'openai/widgetCSP': { resource_domains: [origin], connect_domains: connectDomains } } }] }
}
