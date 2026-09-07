import { useEffect, useRef, useState } from 'react'
import { App } from '@modelcontextprotocol/ext-apps'
import { z } from 'zod'
import { bootstrapSchema, PROTOCOL_VERSION, type Bootstrap } from '../contracts/plugin'
import { DISPLAY_NAME } from './config'

// The host sandbox disallows the dynamic code generation used by Zod's JIT.
z.config({ jitless: true })

export function useHost() {
  const embedded = window.parent !== window
  const client = useRef<App | null>(null)
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  const [mode, setMode] = useState<'inline' | 'fullscreen' | 'pip'>('inline')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onFullscreen = () => setMode(document.fullscreenElement ? 'fullscreen' : 'inline')
    document.addEventListener('fullscreenchange', onFullscreen)
    let stopped = false
    const app = embedded ? new App({ name: DISPLAY_NAME, version: String(PROTOCOL_VERSION) }, {}) : null
    if (app) {
      app.ontoolresult = result => {
        const parsed = bootstrapSchema.safeParse(result._meta?.['codesk/bootstrap'])
        if (!stopped && parsed.success) setBootstrap(current => current ?? parsed.data)
      }
      app.onhostcontextchanged = context => {
        if (!stopped && context.displayMode) setMode(context.displayMode)
      }
      void app.connect(undefined, { timeout: 10_000 }).then(() => {
        if (stopped) return
        client.current = app
        setMode(app.getHostContext()?.displayMode ?? 'inline')
      }).catch(() => { if (!stopped) setError('Could not connect to the host. Reopen the plugin.') })
    }
    return () => {
      stopped = true
      client.current = null
      document.removeEventListener('fullscreenchange', onFullscreen)
      void app?.close().catch(() => {})
    }
  }, [embedded])

  async function toggleFullscreen() {
    setPending(true)
    setError('')
    const next = mode === 'fullscreen' ? 'inline' : 'fullscreen'
    try {
      if (embedded) {
        if (!client.current) throw new Error('Host not connected')
        const result = await client.current.requestDisplayMode({ mode: next }, { timeout: 5000 })
        setMode(result.mode)
        if (result.mode !== next) throw new Error('Display mode declined')
      } else if (next === 'fullscreen') await document.documentElement.requestFullscreen()
      else await document.exitFullscreen()
    } catch { setError('Could not switch display mode. Try again when the view is ready.') }
    finally { setPending(false) }
  }
  return { bootstrap, mode, embedded, pending, error, toggleFullscreen }
}
