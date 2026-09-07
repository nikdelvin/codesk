# CoDesk → Firebase + Google Cloud

Act as the migration engineer for this CoDesk checkout. Inspect it and propose an implementation plan before changing infrastructure. Do not deploy, enable billing, or modify the installed plugin until I approve the target Firebase/Google Cloud project and implementation.

## Inspect

Read `package.json`, `vite.config.ts`, `wrangler.json`, `app.config.json`, `src/example.ts`, `src/contracts/`, `src/plugin/`, `worker/`, `plugin/`, `scripts/`, and `tests/`. Locate Cloudflare-specific MCP handling, assets, Durable Objects, alarms, storage, and test harnesses. Keep React, Vite, Tailwind, and the MCP Apps bridge.

Keep application behavior in `worker/example.ts` separate from connection handling in `worker/realtime.ts`. Replace the Cloudflare relay while preserving its authorized snapshot and broadcast behavior. The browser hook receives the application's frame schema from `src/example.ts`; it does not assume a numeric value.

## Design the replacement

1. Serve the Vite frontend through Firebase Hosting and run a Node MCP/WebSocket server on Cloud Run. Replace `agents/mcp/server` with an HTTP adapter supported by the installed MCP SDK. Keep the current application tools, their arguments, and the shared protocol payloads.
2. Route MCP and WSS directly to Cloud Run unless current official documentation and an end-to-end test prove a proposed proxy route works. Firebase Hosting's documented dynamic request timeout is 60 seconds; do not assume its rewrites are a transparent long-lived WebSocket proxy. Record the separate frontend and backend origins in shared configuration, bootstrap validation, resource CSP, CORS, and generated plugin connections.
3. Use Firestore transactions for run state, monotonically increasing revisions, capability hashes, expiration, and bounded idempotency receipts. Keep stored receipts as individual records or otherwise within document limits. Ensure retry conflicts return the original committed receipt. Keep browser Firestore access disabled; the server owns writes and broadcasts state to the existing browser WebSocket.
4. Synchronize Cloud Run instances through server-side Firestore listeners or another explicitly selected shared channel. Never assume session affinity or an instance-local Map serializes a run. Ensure snapshot/subscription ordering has no lost-update gap. Use transactional connection leases to enforce the configured subscriber limit across instances, with cleanup after process death. Enforce expiration on every operation and connection; Firestore TTL deletion is eventual, not authorization.
5. Configure Cloud Run request timeout and graceful shutdown. Reconnecting sockets may reach a different instance. Preserve backoff, heartbeat, first-state timeout, and snapshot recovery. Review CPU allocation, instance concurrency, listener lifecycle, connection costs, and scale-to-zero behavior with current official documentation.
6. Include the compiled HTML in the server image or fetch only a pinned trusted Hosting asset. Keep MIME, status, marker, and 256 KB validation, content-derived MCP resource IDs, uncached HTML, and immutable hashed assets. Resolve build/deploy URL ordering without hardcoded personal domains.
7. Replace Wrangler commands with explicit Firebase/gcloud login, project selection, build, deploy, URL discovery, smoke checks, and plugin installation scripts. Keep `plugin/` as generic source and the chosen installed plugin name configurable. Use runtime service identity and least-necessary database permissions; commit no keys. Replace Miniflare tests with the target server and Firestore emulator where appropriate.

## Acceptance and delivery

Retain the current state schema, session expiration, mutation/connection limits, private capabilities stored as hashes, and subscription-only WebSockets. Read the values from this checkout. Display state only from validated sockets. Test original receipts, conflicts, parallel writes across instances, isolation, unauthorized sockets, expiry/leases, restarts, reconnects, missing initial state/pong, old-schema rejection, packaged resources, caching, 404s, and installation. Verify representative state changes plus fullscreen without remounting, then perform native Codex acceptance separately.

Fresh example runs may be created after an agreed cutover; identify any additional user data needing migration. Deliver file changes, exact commands, required APIs/regions/variables, cost assumptions, tests, rollback, and unverified limitations. Do not claim emulator tests establish live load-balancer or host behavior.

## Official references to recheck

- [Firebase Hosting and Cloud Run](https://firebase.google.com/docs/hosting/cloud-run)
- [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firestore TTL](https://firebase.google.com/docs/firestore/ttl)
- [Firestore listeners](https://firebase.google.com/docs/firestore/query-data/listen)
