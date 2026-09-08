import { usePluginState } from './plugin/usePluginState'
import { useHost } from './plugin/host'
import { socketMessage } from './example'
import CounterPanel from './components/CounterPanel'

export default function App() {
  const host = useHost()
  const { value, status } = usePluginState(host.bootstrap, socketMessage)
  return <CounterPanel host={host} value={value} status={status} />
}
