---
name: open-plugin
description: Open this plugin's panel when requested and use its connected MCP tools for subsequent actions.
---

# Open Plugin

Use this plugin's connected MCP tools. Follow their descriptions and schemas for available actions, inputs, and limits.

- On an explicit open request, call the tool that opens the panel once. Retain any returned run or session identifier for subsequent actions; never reopen just to display an update.
- When a tool accepts an operation ID, use a fresh UUID per change. Reuse the same ID and arguments only for an uncertain retry.
- For relative changes, use the last confirmed state or inspect once. Never poll tools to drive UI updates.
- If the target is missing, ambiguous, expired, or exhausted, ask the user to open or identify it. Never silently reset.
- Let the panel receive its own live updates. A successful tool result does not prove visible delivery; claim that only when observed.
- If the plugin's MCP tools are unavailable, report the missing connection instead of inventing a tool call.
