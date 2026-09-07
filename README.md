<p align="center"><img src="src/assets/codesk.svg" width="72" height="72" alt="CoDesk logo" /></p>

<h1 align="center">CoDesk</h1>

<p align="center"><strong>CoDesk - your personal AI desk right inside Codex Desktop</strong></p>

<p align="center">React + Vite · Tailwind CSS · Cloudflare Workers · MCP Apps · MIT</p>

`codesk` is a public repository template for building your own interactive Codex plugin. The frontend, backend, plugin instructions, and setup scripts live together. Start with the counter example, then replace it with the workspace you want to use.

- **One setup command:** install dependencies, sign into Cloudflare, choose your plugin name, deploy, run live smoke checks, and install the local Codex plugin.
- **An editable stack:** React/Vite and Tailwind CSS for the frontend; one Cloudflare Worker for MCP, assets, and realtime state.
- **A working example:** a read-only counter driven by WebSocket, with reconnect recovery and fullscreen/inline controls.
- **Verification included:** backend, browser, routing, asset, and plugin installation fixtures.
- **A path to other hosts:** [migration prompts](#codesk-migration-prompts) for Vercel, Firebase + Google Cloud, and self-hosting.

CoDesk is the template brand. Your installed plugin name is chosen during setup and stays independent of the repository name.

## First installation

Install **Node.js 24+** and the **Codex desktop app**, and create a Cloudflare account. `npm ci` installs the pinned Wrangler and Codex CLIs locally; no global CLI or Python installation is needed.

Clone your copy of `codesk`, then run this from the repository root:

```sh
npm ci && npm run setup
```

This is a guided command, not a silent one-click install: Cloudflare login and choosing a name require input. Fully quit and reopen Codex after installation, then start a new task. If the account has no workers.dev subdomain yet, create it once when configuration prompts you. Setup runs deployment smoke checks; install the browser and run the complete local suite separately with `npm run test:install` and `npm run verify`.

To run each step separately, including the full test suite before deployment:

```sh
npm ci
npm run cf:login
npm run configure
npm run test:install
npm run verify
npm run deploy
npm run plugin:install
```

`cf:login` opens Cloudflare's browser login. `configure` asks for a plugin name, selects an account if your login has access to several, and reads that account's actual `workers.dev` subdomain from Cloudflare. If none exists yet, register one in **Cloudflare → Workers & Pages → Your subdomain**, then rerun configure.

For example:

```sh
npm run configure -- --plugin-name my-desk
```

Use `--account <account-id>` when configuring noninteractively with multiple accounts. The plugin name uses lowercase letters, digits and single hyphens (up to 63 characters). For example, `my-desk` installs as `my-desk` and displays **My Desk**. The same name is used for the Worker by default; pass `--name existing-worker` to target a different Worker. Configure writes the Worker name and account ID to `wrangler.json`, and the plugin name and public URL to `app.config.json`. The template uses an unconfigured `https://example.invalid` origin; **run configure before deploying or installing the plugin**. No Cloudflare credentials are stored in the repository. Wrangler manages login separately.

Cloudflare assigns `https://<Worker name>.<account subdomain>.workers.dev` on deployment. `publicOrigin` describes this address; changing that setting does not create a domain. The script verifies the actual account subdomain again before publishing. Owned custom domains require separate route configuration and are outside this setup flow. [Cloudflare URL rules](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

`deploy` builds React and the Worker, checks account access, deploys through the Vite-generated Wrangler configuration, then verifies live MCP discovery, packaged HTML/assets, caching, and missing routes. It discovers the UI through tool metadata without requiring specific tool names or calling application tools. A new Worker gets its own SQLite namespace automatically. Reusing a Worker name in the same account updates that existing Worker.

`plugin:install` checks the deployed MCP endpoint, generates the plugin connection from the same public origin, and installs it through the Codex CLI. Fully quit and reopen Codex, start a new task, and ask **Open My Desk** (or your chosen name). Set it to **5**, **12**, then **3** and toggle fullscreen/inline in that same panel. The native panel check is separate from automated tests.

The app must be signed into Codex. `npm run codex:login` is available if the local CLI also needs login. Plugin installation uses your current Codex profile (`CODEX_HOME` when set); use the same profile as the desktop app.

After dependencies are installed, `npm run setup` combines Cloudflare login, configuration, deployment and plugin installation. Browser installation and tests remain the explicit verification steps above.

## Everyday commands

- `npm run dev`: local Vite development.
- `npm run preview`: build and preview the production Worker.
- `npm run verify`: lint, TypeScript, production build, and all tests.
- `npm run deploy:dry-run`: build and validate the deployment bundle without publishing or logging in.
- `npm run deploy`: rebuild, deploy and smoke-test the current configuration.
- `npm run verify:deployed`: compare the live app with the local production build.
- `npm run verify:example`: optionally exercise the shipped numeric-state example over live WSS (`0 → 5 → 12 → 3`). Adapt or remove this script when replacing the example; setup and deployment do not depend on it.
- `npm run plugin:build`: inspect the generated package without installing it.
- `npm run plugin:install`: install or refresh the plugin; deploy app/name/endpoint changes first.
- `npm run plugin:list`: inspect installed plugins.
- `npm run cf:whoami`: inspect the current Cloudflare login.
- `npm run cf-typegen`: refresh generated Worker types after changing bindings.

Standalone browser preview shows the CoDesk homepage, setup command, architecture guide, downloadable migration prompts, and counter layout without creating a run. Inside Codex, the same app shows a compact counter panel. Both support light/dark appearance; the host fixture tests live state. If Codex has the skill but no MCP tools after an endpoint change, check `plugin:list`, fully quit/reopen Codex and start a new task; the running host can retain an old connection.

## Repository layout

- `src/App.tsx`: counter panel and choice of embedded or standalone presentation.
- `src/example.ts`: example value schema, initial value, mutation input, and validated socket frames.
- `src/components/TemplateHome.tsx`: homepage copy, setup instructions, architecture, and migration links.
- `src/index.css`: Tailwind import, theme tokens, and shared styles.
- `src/assets/codesk.svg` and `src/components/Brand.tsx`: editable logo and wordmark.
- `src/plugin/` and `src/contracts/`: MCP Apps host integration, WebSocket hook, public configuration, and shared protocol.
- `worker/realtime.ts`: reusable WebSocket relay, capability checks, heartbeat replies, connection limits, and expiration cleanup.
- `worker/example.ts`: example session state, snapshot creation, serialized mutations, and retry receipts.
- `worker/codesk.ts`: connects the example to the stable `CoDesk` deployment class.
- `worker/mcp/`: tool registration and packaged HTML loading.
- `plugin/`: plugin manifest and operational skill.
- `scripts/`: configuration, Wrangler deployment, plugin packaging and smoke checks.
- `tests/`: production Worker, actual Vite routing, browser host and installation fixtures.
- `migration-prompts/`: self-contained prompts for planning provider migrations; these are not implemented adapters.
- `wrangler.json`: Worker deployment settings and bindings.
- `app.config.json`: the plugin name and public origin shared by React, the Worker, tests and plugin packaging.

The browser title is set directly in `index.html`. The configured plugin name still controls the panel heading, MCP tool title, and installed package identity.

`CODESK_DO` is the Worker binding used as `env.CODESK_DO`. It points to the plugin's `CoDesk` Durable Object in `worker/codesk.ts`. The class selects the application in `worker/example.ts`, which extends the reusable `WebSocketRelay` in `worker/realtime.ts`. The relay accepts connections and sends application-supplied snapshots and broadcasts; it does not import the example or assume a numeric value. Its hibernation and automatic heartbeat replies follow [Cloudflare's WebSocket server example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/). No extra library or separately deployed server is required.

`getSnapshot(runId)` supplies the current frame and capability hash, or returns `undefined` for a missing, expired, or incompatible session. The relay checks the capability and sends the snapshot while holding the connection lock. Application mutations use the same lock, commit their state, and then call `broadcast(frame)`. This prevents an update from being lost between subscribing and receiving the first snapshot. The browser hook takes the application's message schema from `src/example.ts`; its reconnect and display logic works with other value shapes. Keep frames within its 4,096-character decoder limit.

The `exports.CoDesk` declaration in `wrangler.json` provisions SQLite storage and replaces the legacy tagged `migrations` array. `npm run setup` already builds and deploys the relay with the app; there is no separate WebSocket provisioning command. After a deployment using `exports`, future deployments must keep using `exports`. [Durable Object class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)

This template declares a fresh `CoDesk` namespace. Updating a Worker that already has a differently named Durable Object requires an explicit class-rename declaration; changing the class name in code alone does not transfer its existing namespace. Use a new Worker name for a fresh template deployment, or follow Cloudflare's rename procedure for an existing deployment.

Plugin output lives in ignored `.plugin-build/`. It contains a complete plugin and a local marketplace. Marketplace and MCP server identifiers use a `codesk-` prefix and a hash of the public origin, so different deployments have separate connection identities. The generated plugin directory and manifest use your configured plugin name. Changing that name creates a different plugin identity; remove a previously installed identity separately if you no longer need it. Installation checks MCP identity and a readable HTML UI resource, without hardcoding application tool names. The installer adds a version cachebuster without changing source files and uses supported Codex marketplace/install commands. Keep the checkout while using this local marketplace. No sibling checkout or personal skill-helper path is required.

To publish your own template, retain `LICENSE` and enable **Template repository** in GitHub settings. The CoDesk repository description is **“CoDesk - your personal AI desk right inside Codex Desktop”**. Keep credentials and generated files out of Git; `.gitignore` excludes `node_modules`, `dist`, `.wrangler`, `.plugin-build`, and local environment files. Setup configures your deployment and plugin; choose your GitHub repository name separately.

To replace the example, update these explicit edit points:

1. Replace the preview in `src/App.tsx` and the example copy in `src/components/TemplateHome.tsx`.
2. Define your value schema and initial value in `src/example.ts`, tool actions in `worker/mcp/server.ts`, and session behavior/storage in `worker/example.ts`. The relay, host bridge, and shared envelope in `src/contracts/plugin.ts` can stay unchanged. If you rename the application module, update the import in `worker/codesk.ts`; the deployed class and binding names can stay the same. Changing the UI alone does not replace the numeric-state behavior. Update receipt comparison and validation when changing the payload shape, and bump the stored schema version when existing records are incompatible.
3. Adapt the example assertions in `tests/state.test.mjs`, `tests/browser.test.mjs`, `tests/realtime.test.mjs`, and `tests/routing.test.mjs`, plus the optional `scripts/verify-example.mjs`. Keep reusable discovery, assets, and installation coverage.
4. Update the example description in this README and any plugin instructions you customize. Then run `npm run verify`, deploy, and refresh the plugin.

Setup, plugin packaging, resource identifiers, and the host bridge have no counter-specific names. Keep server imports out of the browser dependency graph.

Tailwind uses the [official Vite integration](https://tailwindcss.com/docs/installation/using-vite), with source scanning limited to `src/`. No external font or icon CDN is required.

## Counter behavior

The read-only display starts at `—` and changes only from validated WebSocket state. Private bootstrap uses `codesk/bootstrap` metadata. The shared contract is protocol version 2; the three tools are:

- `open_plugin({})`: create one run and a private connection bootstrap.
- `set_state({ run_id, value, operation_id })`: set an integer from -999 to 999. Use a fresh operation ID per change; identical retries return the original receipt, and conflicting retries fail.
- `get_state({ run_id })`: inspect state when needed; never poll for UI updates.

Runs expire after one hour, with at most 256 mutations and four subscribers. Capabilities stay in private bootstrap metadata and are stored as hashes. Sockets negotiate `codesk.ws` plus the capability, accept only heartbeat messages, and receive current state on reconnect. Old stored schemas are rejected; there is no migration adapter.

Closing the panel does not immediately delete its session. The example keeps the latest value, revision, and retry receipts in Durable Object storage until the one-hour expiration, so hibernation and reconnects recover the same state. The alarm closes remaining sockets and removes that session's storage. D1 is optional for applications that need long-lived business data; adding it does not replace the relay's connection routing. If you remove session storage, define how missed updates and reconnects recover before dropping the saved snapshot.

MCP is served at `/mcp`, sockets at `/ws/{runId}`, and the UI at `/`. Unknown paths return 404. HTML is uncached; JS/CSS assets are hashed and immutable. The Worker reads packaged HTML through `ASSETS` and derives `ui://<plugin-name>/app/<html-sha256>/index.html`, so browser assets and host resource identity come from the same build. Already-open panels keep their loaded code.

This is an **authless experiment**: anyone who can reach the endpoint can create runs. Authentication and production product workflows are outside this template.

The deployment flow follows [Cloudflare's Vite integration](https://developers.cloudflare.com/workers/vite-plugin/get-started/). UI delivery uses the [standard MCP Apps bridge](https://developers.openai.com/plugins/build/chatgpt-ui#overview).

## CoDesk migration prompts

Use these prompts in a coding-agent task opened at the root of your `codesk` checkout. Each file is self-contained and can also be downloaded from the homepage.

- [Vercel](migration-prompts/vercel.md): replace the Worker with Functions and external state/coordination.
- [Firebase + Google Cloud](migration-prompts/firebase-google-cloud.md): Firebase Hosting, Cloud Run, and Firestore.
- [Self-hosted](migration-prompts/self-hosted.md): Node, SQLite on a persistent volume, and a TLS reverse proxy.

Start with: **“Read migration-prompts/vercel.md and produce the migration plan for this checkout.”** Substitute the file for your provider. Review the proposed storage, realtime behavior, operations, and costs before asking the agent to implement it.

These are planning examples, not tested provider adapters or deploy buttons. Cloudflare is the implemented deployment target. Provider APIs and limits change; each prompt asks the agent to recheck official documentation. No credentials belong in prompts or committed files.

Existing example sessions can be discarded after an explicitly chosen cutover. If you have extended the template with persistent user data, decide how that data is transferred before replacing storage. Keep the MIT license and update setup, plugin connection generation, and tests together.
