# CoDesk → self-hosted

Act as the migration engineer for this CoDesk checkout. Inspect the app and produce a minimal self-hosting plan before implementation. Do not provision a server, change DNS, deploy, or alter the installed plugin until I approve the target host and implementation.

## Inspect

Read `package.json`, `vite.config.ts`, `wrangler.json`, `app.config.json`, `src/contracts/`, `src/plugin/`, `worker/`, `plugin/`, `scripts/`, and `tests/`. Identify Cloudflare-specific APIs and their observable behavior. Retain React, Vite, Tailwind, and the standard MCP Apps client.

## Design the replacement

1. Use a single Node service for MCP HTTP, WebSocket upgrades, and the compiled Vite assets. Replace the Worker/Agents handler with the installed MCP SDK's supported Node transport, and use a standard WebSocket server. Preserve `/mcp`, `/ws/{runId}`, `/`, exact asset paths, and unknown-route 404s.
2. Run one application process initially. Replace Durable Object storage with SQLite on a persistent mounted volume. Use database transactions for state, revisions, original operation receipts, conflicts, and mutation limits; serialize each run's write/broadcast path. Persist enough state to recover after process death, including failure between commit and broadcast. Do not use container-local ephemeral storage for runs.
3. Keep connections in memory for the single process, enforce the configured socket limit per session, and remove them on close/error. Replace alarms with expiration checks on reads/writes/upgrades plus startup and periodic cleanup. Timers alone are not an expiration guarantee. Keep capability hashes private and verify capabilities before accepting subscriptions.
4. Put Caddy in front for HTTPS and WSS on a domain the operator controls. Verify WebSocket upgrades, forwarded headers, MCP streaming behavior, origin checks, body limits, and graceful connection draining. Serve HTML with no-store and hashed assets with immutable caching. Retain HTML MIME/marker/size checks and content-derived resource IDs.
5. Add a small Dockerfile, Compose configuration with a persistent data volume, and a Caddyfile. Handle shutdown signals so sockets close and clients reconnect cleanly. Document unprivileged execution, backups/restoration, disk usage, and TLS/data volume persistence. Keep configuration in environment variables and committed examples without secrets.
6. Adapt setup/build/deploy/smoke-check scripts for a confirmed public HTTPS origin; replace the workers.dev-only validator and account lookup. Generate the configurable plugin connection from that same origin. Preserve the generic `plugin/` source directory and refresh flow. Replace Miniflare tests with the actual Node service and temporary SQLite databases.
7. Explicitly document the single-process boundary. If horizontal scaling is required, propose external transactional storage and shared event delivery before adding replicas. A shared SQLite volume plus several independent socket registries does not replace Durable Object coordination.

## Acceptance and delivery

Preserve the current protocol, tool names/arguments, state schema, expiration and mutation limits, idempotency/conflicts, and subscription-only sockets. Read the definitions from this checkout. Keep browser state WebSocket-only, with first-state timeout, heartbeat, backoff, and reconnect snapshots. Test ordering, isolation, invalid capabilities, prototype-like operation IDs, expiration, limits, old-schema rejection, restart/restore recovery, caching, packaged resources, 404s, and plugin installation.

Demonstrate representative application updates, reconnect after a process restart, and fullscreen without remounting; repeat native Codex acceptance after a permitted deployment. Agree on fresh example runs or a data transfer plan for any extended application data. Deliver changed files, build/run/update/backup commands, environment variables, host requirements, recurring costs, and rollback. Keep the MIT license and identify untested assumptions.

## Official references to recheck

- [Node HTTP server](https://nodejs.org/api/http.html)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Caddy reverse proxy and WebSockets](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Docker volumes](https://docs.docker.com/engine/storage/volumes/)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
