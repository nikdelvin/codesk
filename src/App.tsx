import { usePluginState } from './plugin/usePluginState'
import { useHost } from './plugin/host'
import { DISPLAY_NAME } from './plugin/config'
import Brand from './components/Brand'
import TemplateHome from './components/TemplateHome'

export default function App() {
  const host = useHost()
  const { value, status } = usePluginState(host.bootstrap)
  const fullscreen = host.mode === 'fullscreen'

  const counter = (
    <section aria-label="Counter example" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
        <div>
          <p className="eyebrow mb-1">Example plugin</p>
          <h2 className="text-lg font-semibold">{DISPLAY_NAME}</h2>
        </div>
        <button type="button" className="button-secondary text-xs" onClick={() => void host.toggleFullscreen()}
          disabled={host.pending} aria-busy={host.pending} aria-pressed={fullscreen}>
          <span aria-hidden="true">⛶</span>
          {fullscreen ? host.embedded ? 'Return to inline' : 'Exit fullscreen' : 'Open fullscreen'}
        </button>
      </div>
      <div className="state-grid flex min-h-56 flex-col items-center justify-center px-6 py-8">
        <p className="eyebrow">Current value</p>
        <output aria-label="Counter value" aria-live="polite" className="my-2 text-8xl leading-tight font-medium tracking-tighter text-accent tabular-nums">{value ?? '—'}</output>
        <p className="flex items-center gap-2 text-xs text-muted">
          <span className={`size-1.5 rounded-full ${status.startsWith('Connected') ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {host.embedded ? 'Live WebSocket state' : 'Browser preview · read-only'}
        </p>
      </div>
      <div className="border-t border-line px-6 py-4">
        <p role="status" className="text-sm leading-6 text-muted">{status}</p>
        {host.error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{host.error}</p>}
      </div>
    </section>
  )

  if (host.embedded) return <main className="mx-auto max-w-2xl p-4 sm:p-6">
    <div className="mb-5 flex items-center justify-between"><Brand /><span className="eyebrow">Your AI desk</span></div>
    {counter}
  </main>

  return <TemplateHome>{counter}</TemplateHome>
}
