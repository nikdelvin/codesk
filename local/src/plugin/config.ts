import config from '../../app.config.json' with { type: 'json' }
export const PLUGIN_NAME = config.pluginName
export const DISPLAY_NAME = PLUGIN_NAME === 'codesk-local' ? 'CoDesk Local'
  : PLUGIN_NAME.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')

// Supplied with the MCP resource by the owning runtime, never baked into a build.
export function runtimeContext(): { socketOrigin: string; generation: string } | null {
  if (typeof document === 'undefined') return null
  try {
    const data = JSON.parse(document.querySelector('#codesk-runtime')?.textContent ?? 'null')
    if (typeof data?.socketOrigin === 'string' && /^wss:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(data.socketOrigin)
      && typeof data.generation === 'string') return data
  } catch { /* Standalone development has no runtime bootstrap. */ }
  return null
}
