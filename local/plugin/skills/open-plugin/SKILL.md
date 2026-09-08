---
name: open-plugin
description: Open this local CoDesk plugin, resume or inspect its saved runs, and update its live panel with the connected MCP tools.
---

# CoDesk Local

Use this plugin's connected MCP tools. Its launcher starts the local runtime and HTTPS/WSS tunnel automatically.

- On an explicit new opening, call `open_plugin` once without `run_id`. Retain the returned run ID.
- To resume, use `list_runs` when the ID is unknown, then call `open_plugin` once with the chosen `run_id`.
- For counter changes, call `set_state` on the retained run with a fresh UUID `operation_id`. Reuse an operation ID only to retry the identical change. Never reopen to display a mutation.
- Use `get_state` for inspection, never UI polling. A receipt confirms persisted state; it does not prove native panel rendering.
- Only call `delete_run` when the user explicitly requests deletion. It permanently removes that run and its receipts.
- Runs remain saved across runtime and Codex restarts. If the tunnel address changes, start a fresh task and resume the saved run to load its new panel resource.
- When tools report a runtime or tunnel failure, surface the returned message. The checkout's `npm run diagnostics` and `npm run runtime:restart` commands assist recovery. Do not change certificate trust or browser security.
- Keep user input in the native composer. The panel receives counter values exclusively through WebSocket and offers fullscreen/inline controls.
