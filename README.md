<p align="center"><img src="cloudflare/src/assets/codesk.svg" width="72" height="72" alt="CoDesk logo" /></p>

<h1 align="center">CoDesk</h1>

<p align="center"><strong>Your personal AI desk right inside Codex Desktop.</strong></p>

Build an interactive Codex plugin with React, MCP tools, live WebSocket state, and fullscreen controls. Choose a deployment template, start with the counter, then replace its UI and application behavior with your own.

## Choose your deployment

| Template | Execution and storage | Connection | Setup |
| --- | --- | --- | --- |
| [Cloudflare](cloudflare/README.md) | Worker and SQLite-backed Durable Objects | Hosted HTTPS/WSS | Cloudflare account required |
| [Local](local/README.md) | Your computer and a persistent SQLite file | Plugin-managed Cloudflare Quick Tunnel | No Cloudflare account or domain required |

Both templates require **Node.js 24+** and **Codex Desktop**. Each has its own package, lockfile, setup, plugin instructions, and verification suite. They can be installed together with different plugin names.

For Cloudflare:

```sh
cd cloudflare
npm ci && npm run setup
```

For local:

```sh
cd local
npm ci && npm run setup
```

The local runtime starts automatically when Codex connects its MCP server. Saved runs remain on your computer until explicitly deleted. Browser traffic passes through Cloudflare's HTTPS/WSS tunnel, so this variant requires internet access for the panel.

After installation, fully quit and reopen Codex, start a new task, and ask to open the plugin using the name you chose. Use the native composer to change the example counter; its existing panel updates through WebSocket.

## Make it yours

Each template contains `src/` for the React UI and state contracts, `plugin/` for assistant instructions, and `scripts/` for setup and maintenance. The backend lives in `cloudflare/worker/` or `local/server/`.

Read the selected template's README for architecture, commands, persistence, and acceptance checks. [Migration prompts](migration-prompts/) describe additional hosting approaches; they are planning guides, not implemented deployment templates.

[MIT licensed](LICENSE).
