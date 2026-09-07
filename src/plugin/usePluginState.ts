import { useEffect, useState } from 'react'
import { socketMessage, type Bootstrap, type StateMessage } from '../contracts/plugin'
import { DISPLAY_NAME } from './config'

export function usePluginState(bootstrap: Bootstrap | null) {
  const [value, setValue] = useState<StateMessage['value'] | null>(null)
  const [status, setStatus] = useState(`Open ${DISPLAY_NAME} from the native composer`)

  useEffect(() => {
    if (!bootstrap) return
    let stopped = false
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout>
    let deadline: ReturnType<typeof setTimeout>
    let heartbeat: ReturnType<typeof setInterval>
    let attempts = 0
    let revision = -1
    const clearConnectionTimers = () => { clearTimeout(deadline); clearInterval(heartbeat) }
    const expire = () => {
      stopped = true
      clearTimeout(retry)
      clearConnectionTimers()
      setStatus('Session expired; reopen the plugin from the native composer')
      socket?.close(1000, 'Run expired')
    }
    const expiry = setTimeout(expire, Math.max(0, Date.parse(bootstrap.expiresAt) - Date.now()))
    const connect = () => {
      if (stopped) return
      if (Date.parse(bootstrap.expiresAt) <= Date.now()) { expire(); return }
      setStatus(attempts ? 'Reconnecting; showing the last received value' : 'Connecting')
      const current = new WebSocket(bootstrap.socketUrl, ['codesk.ws', `cap.${bootstrap.capability}`])
      socket = current
      let initialized = false
      // Opening the socket is insufficient: require the first authoritative state.
      deadline = setTimeout(() => current.close(), 10_000)
      current.onmessage = event => {
        if (stopped || current !== socket) return
        if (event.data === 'pong') { if (initialized) clearTimeout(deadline); return }
        if (typeof event.data !== 'string' || event.data.length > 4096) return
        let data: unknown
        try { data = JSON.parse(event.data) } catch { return }
        const parsed = socketMessage.safeParse(data)
        if (!parsed.success) return
        const message = parsed.data
        if (message.type === 'error') {
          if (message.code === 'RUN_EXPIRED') expire()
          else setStatus(message.message)
          return
        }
        if (message.runId !== bootstrap.runId || message.revision < revision) return
        if (!initialized) {
          initialized = true
          clearTimeout(deadline)
          heartbeat = setInterval(() => {
            if (current.readyState !== WebSocket.OPEN) return
            current.send('ping')
            deadline = setTimeout(() => current.close(), 10_000)
          }, 25_000)
        }
        attempts = 0
        setStatus('Connected; use the native composer to update the state')
        if (message.revision === revision) return
        revision = message.revision
        setValue(message.value)
      }
      current.onerror = () => current.close()
      current.onclose = () => {
        if (stopped || current !== socket) return
        clearConnectionTimers()
        setStatus('Disconnected; showing the last received value')
        retry = setTimeout(connect, Math.min(250 * 2 ** Math.min(attempts++, 6), 10_000))
      }
    }
    queueMicrotask(connect)
    return () => {
      stopped = true
      clearTimeout(expiry)
      clearTimeout(retry)
      clearConnectionTimers()
      socket?.close(1000, 'View unmounted')
    }
  }, [bootstrap])
  return { value, status }
}
