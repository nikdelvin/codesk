# CoDesk Local plugin package

This source manifest and skill are packaged by `npm run plugin:build` or `npm run plugin:install` from the local template. Packaging supplies the chosen identity, standalone runtime, self-contained HTML, absolute stdio launch mapping, and machine-local settings.

The runtime starts automatically when Codex connects and shuts down after the final task/panel disconnects plus a 60-second grace period. Saved runs live outside this package. Reinstall after source changes and start a fresh Codex task to load the updated tools and skill.
