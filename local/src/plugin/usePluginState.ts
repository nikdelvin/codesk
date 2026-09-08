import { useEffect, useState } from 'react'
import type { z } from 'zod'
import { SOCKET_PROTOCOL, type Bootstrap, type StateMessage, type ErrorMessage } from '../contracts/plugin'
import { DISPLAY_NAME } from './config'

export function usePluginState<T>(bootstrap: Bootstrap | null, messageSchema: z.ZodType<StateMessage<T> | ErrorMessage>) {
  const [value, setValue] = useState<T | null>(null)
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
    const endRun = () => {
      stopped = true
      clearTimeout(retry)
      clearConnectionTimers()
      setStatus('This run was deleted; explicitly open another run')
      socket?.close(1000, 'Run deleted')
    }
    const connect = () => {
      if (stopped) return
      setStatus(attempts ? 'Reconnecting; showing the last received value' : 'Connecting')
      const current = new WebSocket(bootstrap.socketUrl, [SOCKET_PROTOCOL, `cap.${bootstrap.capability}`])
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
        const parsed = messageSchema.safeParse(data)
        if (!parsed.success) return
        const message = parsed.data
        if (message.type === 'error') {
          if (message.code === 'RUN_DELETED' || message.code === 'RUN_NOT_FOUND') endRun()
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
        setStatus('Disconnected; showing the last received value. If the runtime restarted, resume this run in a fresh task.')
        retry = setTimeout(connect, Math.min(250 * 2 ** Math.min(attempts++, 6), 10_000))
      }
    }
    queueMicrotask(connect)
    return () => {
      stopped = true
      clearTimeout(retry)
      clearConnectionTimers()
      socket?.close(1000, 'View unmounted')
    }
  }, [bootstrap, messageSchema])
  return { value, status }
}
