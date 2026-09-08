# Plugin source

This source folder stays named `plugin/` regardless of the name chosen during setup. The installer copies these files into `.plugin-build/plugins/<pluginName>/` and sets the package identity from `app.config.json`. From the repository root, run `npm run plugin:install` after deployment.

The installer checks MCP discovery, generates the connection from `app.config.json`, adds a version cachebuster, and registers a local marketplace using the project-installed Codex CLI. `npm run plugin:build` only packages the files for inspection under `.plugin-build/`; it does not install anything.

Keep this checkout while using its local marketplace. After installation or an endpoint change, fully quit and reopen Codex and start a new task. Open the plugin using your configured name, exercise its actions, and verify live updates and fullscreen/inline in the same panel. Tool receipts alone do not establish visible delivery.
