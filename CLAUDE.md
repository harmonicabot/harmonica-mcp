# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server for Harmonica, enabling AI agents to create and query Harmonica sessions programmatically. Published to npm as `harmonica-mcp`.

## Commands

```bash
npm run build   # Compile TypeScript → dist/
npm run dev     # Watch mode compilation
npm start       # Run the MCP server (requires HARMONICA_API_KEY env var)
```

Vitest test suite — `npm test` (`src/client.test.ts`, `src/methodSpec.test.ts`, `src/index.test.ts`). No linter configured.

`npm test` runs `npm run build` first, because `index.test.ts` drives the **built** `dist/index.js` over stdio rather than importing a factory — what we publish is the binary, so the tests send the same `tools/list` a real client sends. That also catches bootstrap failures (bad import specifier, transport wiring) a unit test would miss.

## Publishing

Published to npm (`harmonica-mcp`). Users install via `npx -y harmonica-mcp`.

```bash
npm version patch|minor|major   # Bump version in package.json
npm publish                     # Runs prepublishOnly → build → publish
```

## Architecture

```
AI Agent (Claude Code, etc.)
  ↕ stdio (MCP protocol)
harmonica-mcp (this project)
  ↕ HTTP (REST API)
Harmonica API (app.harmonica.chat/api/v1)
  ↕ SQL
Neon Postgres
```

This is a **client** of the Harmonica REST API (`/api/v1/`), which lives in `harmonica-web-app/`. ESM module (`"type": "module"` in package.json).

Source files:
- `src/index.ts` — MCP server entry point. Collects tool registrations, then `serveStdio(createServer)`.
- `src/client.ts` — HTTP client wrapping the Harmonica REST API. All methods throw on HTTP errors.
- `src/methodSpec.ts` — parses OFL method specs (`method.md`) into chain configs.

## MCP SDK v2

On `@modelcontextprotocol/server` v2 (the package **split** — there is no `@modelcontextprotocol/sdk@2`; a server takes `server`+`core` and drops the client half). Requires **zod 4** and **Node >= 20**, both declared.

Three things to know before editing `index.ts`:

- **`serveStdio` takes a factory, not a server.** The stateless core (SEP-2575/SEP-2567) lets the SDK build one server per connection. Tools are therefore collected into a `registrations` array at module load and replayed onto each server `createServer()` builds. Over stdio there is only ever one connection; the shape exists so HAR-602's HTTP transport needs no rework.
- **Register tools through the local `tool()` helper, never `server.registerTool` directly.** The helper wraps the raw shape in `z.object()` at a single boundary. Raw-shape `inputSchema` still works — the SDK auto-wraps it — but it is deprecated, and the auto-wrap emits **byte-identical JSON Schema**, so nothing at runtime tells you which path a tool took. `index.test.ts` guards this structurally by asserting there is exactly one `registerTool` call.
- **The 2026-07-28 `_meta` envelope needs both `protocolVersion` and `clientCapabilities`.** Sending only the first is a `-32602`. Requests with no `_meta` are treated as 2025-era and are answered normally, minus the cacheable-result fields.

`tools/list` carries a cache hint (`ttlMs` 1h, `cacheScope: 'public'`, SEP-2549) set via `cacheHints` on the `McpServer` constructor. It is emitted only to 2026-07-28 clients — sending those fields to a 2025-era client would be a protocol violation.

## MCP Tools (exposed in index.ts)

| Tool | Description |
|------|-------------|
| `create_session` | Create a new session and get a shareable join URL (optional `project_id` to file it under a project) |
| `update_session` | Update session metadata (topic, goal, context, critical, prompt; `project_id` to move into a project or `null` to detach) |
| `list_sessions` | List sessions with optional status filter and search |
| `get_session` | Get full session details including facilitation prompt |
| `list_participants` | List participants for a session |
| `get_questions` | Get pre-session questions (data collection form) |
| `get_responses` | Get participant responses for a session |
| `get_summary` | Get AI-generated session summary |
| `generate_summary` | Trigger summary generation on demand |
| `search_sessions` | Search sessions by topic/goal keywords |
| `list_telegram_groups` | List Telegram groups registered to the user's account |
| `chat_message` | Send a message in a session conversation and get facilitator response |
| `submit_questions` | Submit pre-session question answers and start facilitated conversation |
| `install_method_spec` | Install an OFL method spec (method.md) as a runnable chain template |
| `create_project` | Create a project (workspace) you own |
| `list_projects` | List projects (workspaces) you have access to |
| `get_project` | Get a project by id, with the ids of its linked sessions |
| `update_project` | Rename a project or update its description (editor role) |
| `delete_project` | Soft-delete a project; contained sessions are left intact (owner role) |
| `publish_sensemaking_topic` | Publish a project as a public sensemaking topic (`/explore` + `/t/[slug]`) |

## Client methods NOT yet exposed as tools

`client.ts` has additional methods with no corresponding MCP tool:
- `getMe()` — current user info
- `submitResponse(sessionId, content)` — submit a response (non-conversational)
- `getSensemakingTopic(projectId)` — read a project's sensemaking-topic publish status

## API endpoints NOT yet in client

These API endpoints exist but have no client method or MCP tool yet:
- `POST /sessions/{id}/scratchpad` — seed/update cross-pollination scratchpad (HAR-663 items 2-3). Supports `mode: seed | update | status`. See API docs.

## Versioning

The McpServer version is read from `package.json` at startup. Bump with `npm version patch|minor|major` — no other file to update.

## Environment Variables

- `HARMONICA_API_KEY` (required) — API key from Harmonica dashboard
- `HARMONICA_API_URL` (optional) — API base URL, defaults to `https://app.harmonica.chat`

## Related Projects

- `harmonica-web-app/` — Main Harmonica platform (API source, defines `/api/v1/` endpoints)
- `harmonica-chat/` — Claude Code slash command for session creation (uses this MCP server)
- `harmonica-sync/` — CLI tool to sync sessions to markdown (uses the same REST API)
