# CoDesk → Vercel

Act as the migration engineer for this CoDesk checkout. First inspect the current code and write a concrete migration plan. Do not deploy, provision paid services, or change the installed plugin until I approve the implementation and target project.

## Inspect

Read `package.json`, `vite.config.ts`, `wrangler.json`, `app.config.json`, `src/example.ts`, `src/contracts/`, `src/plugin/`, `worker/`, `plugin/`, `scripts/`, and `tests/`. Identify every dependency on Cloudflare, including `agents/mcp/server`, Durable Objects, `cloudflare:workers`, `ASSETS`, alarms, and generated binding types. Retain React, Vite, Tailwind, and the standard MCP Apps bridge.

Keep application behavior in `worker/example.ts` separate from connection handling in `worker/realtime.ts`. Replace the Cloudflare relay while preserving its authorized snapshot and broadcast behavior. The browser hook receives the application's frame schema from `src/example.ts`; it does not assume a numeric value.

## Design the replacement

1. Serve the Vite build on Vercel. Replace Worker dispatch and the Cloudflare MCP handler with a supported Node HTTP adapter for the installed MCP SDK. Keep `/mcp`, `/ws/{runId}`, root HTML, and hashed assets; preserve 404s for unknown routes.
2. Check Vercel's current WebSocket support, runtime, beta availability, request duration, deployment behavior, and local emulator support. The official WebSocket page checked on 2026-09-07 describes native Function support in beta, so do not assume either universal availability or that Vercel cannot host sockets. If unsuitable for the target project, propose a separately hosted WebSocket service and identify its cost and extra origin before implementing.
3. Replace Durable Objects with shared durable state and coordination, such as an appropriate Redis service. Show how atomic transactions/scripts enforce revisions, original retry receipts, conflicts, expiration, the configured mutation and connection limits across instances. Verify the chosen service supports the required connection and pub/sub APIs. An instance-local Map is insufficient.
4. Design snapshot-plus-subscription ordering so updates cannot fall between subscription and initial state. Account for dropped pub/sub notifications and the commit-to-broadcast failure gap, using a durable stream/outbox or equivalent recovery. Use expiring connection leases and restart-safe cleanup, not only process timers. Enforce expiration during reads and writes even when deletion is delayed.
5. Package and read HTML with status, MIME, marker, and 256 KB checks. Preserve uncached HTML, immutable hashed assets, content-derived MCP resource IDs, and the private capability bootstrap. Configure exact trusted HTTPS/WSS origins and resource CSP; support split origins only if required by the proposed topology.
6. Replace Cloudflare-specific setup/account lookup in `scripts/` with project linking and confirmed deployed URL discovery. Keep the configurable plugin name and generated local package in `plugin/` → `.plugin-build/`. Update deployment probes and replace Miniflare with the target runtime test harness.

## Acceptance and delivery

Keep the current tool names/arguments, state schema, expiration policy, capability hashes, and subscription-only sockets. Read their definitions from this checkout rather than assuming the original example is unchanged. Preserve WebSocket-only displayed state, first-state timeout, heartbeat, reconnect snapshots, and fullscreen in the original React mount. Fresh example sessions are acceptable at an agreed cutover; identify any additional user data before discarding storage.

Plan tests for ordered updates, simultaneous writes on separate instances, duplicate/conflicting retries, isolation, invalid capabilities, old schema rejection, limits, expiration, process termination between commit and publish, reconnecting onto another instance, missing initial state/pong, and representative application actions with fullscreen. Verify MCP resources, caching, missing routes, and plugin installation. Include exact changed files, commands, environment variables, provisioning/billing assumptions, rollback steps, and a separate native Codex acceptance step. State what has and has not been tested.

## Official references to recheck

- [Vercel Vite support](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel WebSockets](https://vercel.com/docs/functions/websockets)
- [Function duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
