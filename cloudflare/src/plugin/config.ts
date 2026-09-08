import config from '../../app.config.json' with { type: 'json' }

// Public identity shared by React, the Worker, Vite, tests and plugin packaging.
export const PLUGIN_NAME = config.pluginName
export const DISPLAY_NAME = PLUGIN_NAME === 'codesk' ? 'CoDesk' : PLUGIN_NAME.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
export const PUBLIC_ORIGIN = config.publicOrigin
export const SOCKET_ORIGIN = PUBLIC_ORIGIN.replace('https:', 'wss:')
export const UI_PATH = '/index.html'
export const resourceUri = (htmlHash: string) => `ui://${PLUGIN_NAME}/app/${htmlHash}/index.html`
