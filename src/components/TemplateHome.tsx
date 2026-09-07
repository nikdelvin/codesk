import { useState, type ReactNode } from 'react'
import Brand from './Brand'
import vercelPrompt from '../../migration-prompts/vercel.md?url&no-inline'
import googlePrompt from '../../migration-prompts/firebase-google-cloud.md?url&no-inline'
import selfHostedPrompt from '../../migration-prompts/self-hosted.md?url&no-inline'

const setupCommand = 'npm ci && npm run setup'
const folders = [
  { path: 'src/', label: 'Make it yours', detail: 'Edit App.tsx and components/ for your UI. Style it with Tailwind in index.css.', tag: 'FRONTEND', icon: '01' },
  { path: 'worker/', label: 'Give it capabilities', detail: 'Define MCP tools in mcp/server.ts. Keep persistent state in codesk.ts.', tag: 'BACKEND', icon: '02' },
  { path: 'plugin/', label: 'Teach your assistant', detail: 'Edit the manifest and skills/open-plugin/SKILL.md. Setup supplies your chosen name.', tag: 'PLUGIN', icon: '03' },
]
const migrations = [
  { name: 'Vercel', detail: 'Functions, shared state, and realtime connections.', file: vercelPrompt, filename: 'vercel.md', mark: '▲' },
  { name: 'Firebase + Google Cloud', detail: 'Firebase Hosting, Cloud Run, and Firestore.', file: googlePrompt, filename: 'firebase-google-cloud.md', mark: '↗' },
  { name: 'Self-hosted', detail: 'A Node server, persistent storage, and your own domain.', file: selfHostedPrompt, filename: 'self-hosted.md', mark: '⌘' },
]

export default function TemplateHome({ children }: { children: ReactNode }) {
  const [copyState, setCopyState] = useState('')
  async function copySetup() {
    try { await navigator.clipboard.writeText(setupCommand); setCopyState('Copied to clipboard') }
    catch { setCopyState('Select and copy the command below') }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:z-10 focus:bg-surface focus:p-3">Skip to content</a>
      <header className="flex flex-wrap items-center justify-between gap-5 border-b border-line py-6">
        <a href="#" aria-label="CoDesk home"><Brand /></a>
        <nav aria-label="Main navigation" className="flex items-center gap-5 text-xs font-medium text-muted sm:gap-7 sm:text-sm">
          <a className="hover:text-ink" href="#architecture">Architecture</a>
          <a className="hover:text-ink" href="#migrations">Migrations</a>
          <a className="text-ink hover:text-accent" href="#setup">Get started <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <main id="main">
        <section className="grid items-center gap-12 py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-24">
          <div>
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 font-mono text-[10px] tracking-wider uppercase">
              <span className="size-1.5 rounded-full bg-accent" />Open source. Yours to build.
            </p>
            <h1 className="text-[clamp(2.5rem,5vw,3.7rem)] leading-[1.08] font-semibold tracking-[-0.055em]">
              Your personal<br />AI desk, <span className="text-accent">right<br className="hidden lg:block" /> inside Codex<br className="hidden lg:block" /> Desktop.</span>
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-muted">From a small idea to your own interactive plugin. React, a realtime backend, and your assistant’s instructions — together in one editable repository.</p>
            <div className="mt-8 flex flex-wrap items-center gap-5">
              <a className="button-primary" href="#setup">Build your desk <span aria-hidden="true">↗</span></a>
              <a className="text-sm font-medium hover:text-accent" href="#architecture">Explore the code <span aria-hidden="true">→</span></a>
            </div>
            <p className="mt-5 font-mono text-[10px] tracking-wide text-muted">MIT LICENSED <span className="px-2">/</span> YOUR CODE <span className="px-2">/</span> YOUR CLOUD</p>
          </div>
          <div className="relative isolate min-w-0">
            <div className="desk-glow pointer-events-none absolute inset-0 -z-10" />
            <div className="rounded-[22px] border border-line bg-tint/60 p-3 shadow-xl shadow-slate-900/5 sm:p-4">
              <div className="mb-3 flex items-center justify-between px-2">
                <span className="flex gap-1.5" aria-hidden="true"><i className="size-2 rounded-full bg-muted/30" /><i className="size-2 rounded-full bg-muted/30" /><i className="size-2 rounded-full bg-muted/30" /></span>
                <span className="font-mono text-[10px] text-muted">your first desk / counter</span>
                <span className="text-xs text-muted" aria-hidden="true">⌘</span>
              </div>
              {children}
              <div className="mt-3 flex gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-5 text-muted">
                <span className="font-mono text-accent" aria-hidden="true">↳</span>
                <p>In Codex, ask “Set the counter to 5.”<br /><span className="text-ink">Same panel. New state. No reopening.</span></p>
              </div>
            </div>
            <p className="mt-5 text-center font-mono text-[10px] text-muted">A real counter example. Your next idea goes here.</p>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-x-7 gap-y-4 border-y border-line py-6 text-sm font-medium">
          <span className="eyebrow">Small stack. Full loop.</span>
          {['React + Vite', 'Tailwind CSS', 'Cloudflare Workers', 'MCP Apps'].map(name => <span key={name}>{name}</span>)}
        </div>

        <section id="setup" className="grid gap-10 py-20 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <div>
            <p className="eyebrow mb-4">01 / From clone to Codex</p>
            <h2 className="section-title">One command.<br />Your desk is on its way.</h2>
            <p className="mt-5 max-w-sm text-sm leading-7 text-muted">Clone your copy of <code className="text-ink">codesk</code>, open a terminal in the repository, and run setup. It connects the pieces for you.</p>
            <p className="mt-4 max-w-sm text-xs leading-6 text-muted">You’ll need Node.js 24+, Codex Desktop, and a Cloudflare account. Login and naming are interactive. After installation, reopen Codex and start a new task.</p>
          </div>
          <div>
            <div className="overflow-hidden rounded-xl bg-[#172032] text-white shadow-lg shadow-slate-900/5">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                <span className="font-mono text-[10px] text-slate-400">TERMINAL · REPOSITORY ROOT</span>
                <button className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white" type="button" onClick={() => void copySetup()} aria-label="Copy setup command">Copy <span aria-hidden="true">⧉</span></button>
              </div>
              <pre className="overflow-x-auto px-5 py-7 text-[13px] sm:text-sm"><code><span className="select-none text-blue-400">$ </span>{setupCommand}</code></pre>
            </div>
            <p aria-live="polite" className="min-h-7 py-1 text-xs text-muted">{copyState}</p>
            <ol className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {['Log in', 'Name it', 'Deploy', 'Install plugin'].map((step, i) => <li key={step} className="border-t border-line pt-3"><span className="eyebrow">0{i + 1}</span><p className="mt-2 text-xs font-medium">{step}</p></li>)}
            </ol>
            <p className="mt-5 text-xs leading-6 text-muted">Setup discovers your Cloudflare subdomain, builds and smoke-tests the deployment, then installs the plugin into your local Codex profile. No connection files to copy by hand.</p>
          </div>
        </section>

        <section id="architecture" className="border-t border-line py-20">
          <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
            <div><p className="eyebrow mb-4">02 / A place for everything</p><h2 className="section-title">Easy to read. Ready to remix.</h2></div>
            <p className="max-w-xs text-sm leading-6 text-muted">One repository. One Cloudflare Worker.<br />Clear places to make your changes.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {folders.map(folder => <article key={folder.path} className="rounded-xl border border-line bg-surface p-6">
              <div className="mb-8 flex items-center justify-between"><span className="flex size-10 items-center justify-center rounded-lg bg-tint font-mono text-xs text-accent">{folder.icon}</span><span className="eyebrow">{folder.tag}</span></div>
              <h3 className="font-mono text-xl font-medium tracking-tight">{folder.path}</h3>
              <p className="mt-3 text-sm font-semibold">{folder.label}</p>
              <p className="mt-2 text-sm leading-6 text-muted">{folder.detail}</p>
            </article>)}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line px-5 py-4 text-xs leading-6 text-muted">
            <p><code className="text-ink">src/contracts/</code> keeps browser and backend in sync.</p>
            <p><code className="text-ink">app.config.json</code> holds your plugin name and public URL.</p>
          </div>
        </section>

        <section className="grid gap-8 border-t border-line py-12 sm:grid-cols-3" aria-label="Included features">
          {[
            ['Live by design', 'WebSocket updates, reconnect recovery, and fullscreen that keeps the same panel alive.'],
            ['Tests included', 'MCP, storage, routing, browser interactions, and installation fixtures come with the example.'],
            ['Start small. Make it yours.', 'The authless counter is a starting point. Replace its tools and UI with your own workflow.'],
          ].map(([title, detail]) => <div key={title}><h3 className="mb-3 text-sm font-semibold"><span className="mr-2 text-accent" aria-hidden="true">↗</span>{title}</h3><p className="text-sm leading-6 text-muted">{detail}</p></div>)}
        </section>

        <section id="migrations" className="mb-16 rounded-2xl border border-line bg-surface p-6 sm:p-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
            <div><p className="eyebrow mb-4">03 / Bring your own cloud</p><h2 className="section-title">Your desk can move.</h2></div>
            <p className="max-w-sm text-sm leading-6 text-muted">Start on Cloudflare. Use the included prompts to plan a move with your coding agent. These are migration starting points, not prebuilt adapters.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {migrations.map(provider => <a key={provider.name} className="group rounded-xl border border-line p-5 transition-colors hover:border-accent hover:bg-tint" href={provider.file} download={provider.filename}>
              <div className="mb-5 flex justify-between text-xl"><span aria-hidden="true">{provider.mark}</span><span className="text-muted group-hover:text-accent" aria-hidden="true">↓</span></div>
              <h3 className="text-sm font-semibold">{provider.name}</h3>
              <p className="mt-2 text-xs leading-6 text-muted">{provider.detail}</p>
              <p className="mt-5 font-mono text-[10px] text-accent">DOWNLOAD MIGRATION PROMPT</p>
            </a>)}
          </div>
          <p className="mt-6 text-xs leading-6 text-muted">Or open <code className="text-ink">migration-prompts/</code> in your checkout. Each prompt covers hosting, persistent state, realtime delivery, and acceptance checks.</p>
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-5 border-t border-line py-8">
        <Brand />
        <p className="max-w-sm text-xs leading-6 text-muted">CoDesk - your personal AI desk right inside Codex Desktop</p>
        <a className="text-xs text-muted hover:text-ink" href="#setup">Build something of your own ↗</a>
      </footer>
    </div>
  )
}
