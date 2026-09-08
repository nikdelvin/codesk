# CoDesk Local

An independently runnable CoDesk template with a React panel, local MCP stdio tools, persistent SQLite, and a plugin-managed HTTPS/WSS tunnel. Start with the counter example and replace its application module with your own behavior.

Application execution and saved data stay on your computer. Browser traffic passes through Cloudflare. Internet access is required to open a panel; no Cloudflare account, domain, Worker, or locally issued certificate is needed.

## Setup

Requires **Node.js 24+** and **Codex Desktop**. Open a terminal in this folder:

```sh
npm ci && npm run setup
```

Setup asks for a plugin name (default `codesk-local`), finds cloudflared or downloads a pinned official binary after verifying its SHA-256 checksum, builds the runtime, checks real HTTPS/WSS connectivity, and installs the plugin. It uses your signed-in Codex profile; `CODEX_HOME` is respected by the Codex CLI.

Fully quit and reopen Codex, start a fresh task, then ask **“Open CoDesk Local.”** Ask **“Set the counter to 5”**, then **12**, then **3**. Values should change in the same panel. Fullscreen and return-to-inline controls remain available.

For noninteractive configuration:

```sh
npm run setup -- --plugin-name my-local-desk --yes
```

`npm run configure` also accepts `--cloudflared /absolute/path/to/cloudflared` and `--data-dir /absolute/path/to/data`. A chosen data directory must be dedicated to this plugin. Node's native SQLite support is used; Node 24 may print its experimental-feature notice on stderr.

The installer writes to `~/plugins/<plugin-name>` and appends a new entry to the personal marketplace at `~/.agents/plugins/marketplace.json`. Existing entries retain their order and settings. Reinstallation refreshes the plugin version, stops its old runtime, and preserves saved runs. Different plugin names allow local and Cloudflare templates to coexist.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite UI development; standalone preview has no active run |
| `npm run build` | Type-check and bundle the UI and runtime |
| `npm run test:install` | Install Chromium for browser tests |
| `npm run verify` | Lint, type-check, build, and run all automated tests |
| `npm run verify:tunnel` | Check actual stdio MCP → trusted HTTPS/WSS delivery; deletes only its own probe run |
| `npm run plugin:build` | Package into ignored `.plugin-build/` without installation |
| `npm run plugin:install` | Install or refresh the current build |
| `npm run plugin:list` | List installed plugins |
| `npm run runtime:status` | Inspect the current runtime without starting it |
| `npm run runtime:stop` | Stop the runtime and tunnel; preserve SQLite |
| `npm run runtime:restart` | Restart, check readiness, and obtain a new tunnel address |
| `npm run diagnostics` | Print sanitized configuration and runtime status |

Build after editing code, then reinstall to update the packaged runtime. The runtime never loads the checkout's source or `node_modules`. Its launch mapping contains absolute paths; it can also find its own settings beside the bundle when launched from another working directory.

## Architecture and lifecycle

```text
Codex → MCP stdio launcher → authenticated loopback control listener
                                      ↓
                            shared Node runtime → state.sqlite
                                      ↑
Panel → HTTPS/WSS → Quick Tunnel → loopback public HTTP/WS listener
```

All MCP processes for an installation share one runtime and tunnel. A separate tiny `runtime-lock.sqlite` file holds an exclusive OS-managed lock; it contains no application state and is never deleted to recover a lock. The OS releases ownership when the process exits, including after a crash. An authenticated runtime descriptor provides discovery without trusting a PID or exposing its control token publicly.

MCP startup waits only for the local runtime. Tunnel startup happens asynchronously. Panel openings and resource reads wait up to 45 seconds for its HTTPS health check, then fail with an actionable error. Persistent state inspection and mutations remain local even when the tunnel is unavailable.

The public listener serves only `/`, `/index.html`, `/health`, and subscription-only `/ws/{runId}`. Administrative and mutation operations use a separate bearer-authenticated loopback listener that is never tunneled. Public health reports runtime/generation identity, not saved data or credentials.

Each public address has a generation ID. MCP resource URIs include the build hash and generation, and the runtime supplies exact HTTPS/WSS CSP origins with the self-contained HTML. Temporary hostnames are not embedded in builds. A cached resource from an older generation fails explicitly instead of silently loading mismatched connection metadata.

The runtime stays alive while any MCP client or panel socket is connected. Once both counts reach zero, it shuts down after 60 seconds. Keepalive detects dead peers. A child watchdog owns cloudflared and terminates it if the runtime dies abruptly. A tunnel-process failure triggers at most three replacement attempts with 1-, 2-, and 4-second backoff. Startup and readiness failures appear in diagnostics.

A replacement tunnel receives a new public address and resource generation. Old panels retain their last received value and show disconnected status. Start a fresh task, list the saved runs, and resume one to obtain a new panel. A runtime restart cannot make an already-mounted panel discover a different hostname automatically.

Cloudflared receives an explicit private Quick Tunnel configuration, with inherited tunnel settings excluded. Existing Cloudflare configuration and certificate trust remain untouched. [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) are intended for personal development/testing, have no uptime guarantee, and do not support SSE; this template keeps MCP on stdio. Heartbeat and snapshot recovery handle interrupted [WebSocket connections](https://developers.cloudflare.com/network/websockets/).

## Saved runs and tools

Application state lives in one WAL-enabled `state.sqlite` file. The separate coordination database is only a process lock. Default data locations are:

- macOS: `~/Library/Application Support/codesk/<plugin-name>/`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/codesk/<plugin-name>/`
- Windows: `%LOCALAPPDATA%/codesk/<plugin-name>/`

The data directory also holds installation identity, bounded runtime logs, and private runtime metadata. It lives outside the installed plugin and Codex caches. Updates, runtime shutdown, and plugin removal preserve it. Only explicit run deletion removes application records. Use SQLite's backup facilities or stop the runtime before copying the database; a running WAL database can have pending data in its WAL file.

Tools:

- `open_plugin({run_id?})`: create a new run or explicitly resume an existing one. The result exposes the run ID; subscription capabilities stay in component metadata.
- `set_state({run_id, value, operation_id})`: set an integer from −999 to 999. State, revision, and receipt commit atomically before broadcasting. An identical retry returns the original receipt; a changed payload with the same operation ID conflicts within that run.
- `get_state({run_id})`: inspect persisted value, revision, and timestamps. Never use it to poll the UI.
- `list_runs({limit?, cursor?})`: newest-updated first, default 50, maximum 100, with an opaque next cursor. Pagination reflects live data; a concurrently updated run may move between pages.
- `delete_run({run_id})`: explicitly delete the run and its receipts, and close its subscriptions. Repeating deletion is safe.

Runs do not expire and there is no lifetime mutation cap. Receipts remain until deletion. Database migrations run transactionally; a newer incompatible schema is rejected without resetting it. The local protocol is version 3 and is independent of the Cloudflare variant's expiring sessions.

## Customize

Keep the current panel styling or edit `src/App.tsx` and `src/index.css`. Replace `src/example.ts` and `server/example.ts` together for different state behavior. `server/storage.ts` owns SQLite persistence, `server/realtime.ts` owns the subscription relay, and `server/daemon.ts` owns routing and lifecycle. MCP tool definitions are in `server/stdio.ts`; instructions are in `plugin/skills/open-plugin/SKILL.md`.

Server imports must stay out of the browser dependency graph. Preserve Zod's jitless setting for the host sandbox. UI state must come from validated WebSocket frames; tool results provide connection bootstrap, not rendered values. Bump the database/protocol version when incompatible changes require it.

When changing value types, update the SQLite schema and migrations, retry comparison, and tests together. The subscription relay accepts application-defined snapshot objects.

## Acceptance

See the dated [implementation verification](VERIFICATION.md) for the checks completed on this template and the remaining native-host acceptance boundary.

`npm run verify` checks storage transactions, persistence, retries, deletion, isolation, process election/restarts, stale metadata, tunnel failure, watchdog cleanup, packaged startup, installation updates, CSP/resource generations, and browser rendering. The browser uses an explicitly identified host fixture and real local sockets. `verify:tunnel` separately uses a real Quick Tunnel with ordinary certificate verification and writes sanitized `.local/tunnel-evidence.json`.

Native Codex acceptance is a separate check:

1. Open the installed plugin in a fresh task. Record its run ID, initial value 0, and connected state.
2. Use the native composer for 5 → 12 → 3. Verify one unchanged visible panel, then test fullscreen and return to inline.
3. Close/restart the runtime and Codex. In a fresh task, list runs and resume the recorded run. Verify value 3 and its revision are preserved.
4. Delete that test run only after explicitly requesting deletion, then verify its subscriptions close.

Successful MCP receipts, a browser fixture, and a trusted WSS smoke test do not by themselves prove native rendering or fullscreen behavior. macOS is the initial validation platform; the Node scripts and download manifest include macOS arm64/x64, Linux arm64/x64, and Windows x64, with other platforms requiring an installed cloudflared binary.

[MIT licensed](LICENSE).
