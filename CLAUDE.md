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
- `src/index.ts` — bootstrap only. Reads env, picks the transport, wires it. No tool definitions.
- `src/tools.ts` — the 26 tool definitions and `createServer(client, version)`. Pure: no env reads, no filesystem, no transport.
- `src/http.ts` — `startHttpServer()`. `node:http` plus the SDK's web-standard handler. Loaded lazily, so a stdio run never pays for it.
- `src/client.ts` — HTTP client wrapping the Harmonica REST API. All methods throw on HTTP errors.
- `src/methodSpec.ts` — parses OFL method specs (`method.md`) into chain configs.

## MCP SDK v2

On `@modelcontextprotocol/server` v2 (the package **split** — there is no `@modelcontextprotocol/sdk@2`; a server takes `server`+`core` and drops the client half). Requires **zod 4** and **Node >= 20**, both declared.

Three things to know before editing `index.ts`:

- **`serveStdio` takes a factory, not a server.** The stateless core (SEP-2575/SEP-2567) lets the SDK build one server per connection. Tools are therefore collected into a `registrations` array at module load and replayed onto each server `createServer()` builds. Over stdio there is only ever one connection. That shape is what let the HTTP transport reuse `createServer` unchanged, building a fresh per-request server bound to the caller's own key.
- **Register tools through the local `tool()` helper, never `server.registerTool` directly.** The helper wraps the raw shape in `z.object()` at a single boundary. Raw-shape `inputSchema` still works — the SDK auto-wraps it — but it is deprecated, and the auto-wrap emits **byte-identical JSON Schema**, so nothing at runtime tells you which path a tool took. `index.test.ts` guards this structurally by asserting there is exactly one `registerTool` call.
- **The 2026-07-28 `_meta` envelope needs both `protocolVersion` and `clientCapabilities`.** Sending only the first is a `-32602`. Requests with no `_meta` are treated as 2025-era and are answered normally, minus the cacheable-result fields.

`tools/list` carries a cache hint (`ttlMs` 1h, `cacheScope: 'public'`, SEP-2549) set via `cacheHints` on the `McpServer` constructor. It is emitted only to 2026-07-28 clients — sending those fields to a 2025-era client would be a protocol violation.

## MCP Tools (defined in tools.ts)

| Tool | Description |
|------|-------------|
| `create_session` | Create a new session and get a shareable join URL (optional `project_id` to file it under a project; `roster` for role-based chain templates). Reports the chain bootstrap outcome when `template_id` names a chain. |
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
| `chat_message` | Send a message in a session conversation and get facilitator response, including any emitted widget rendered as text |
| `submit_questions` | Submit pre-session question answers and start facilitated conversation |
| `install_method_spec` | Install an OFL method spec (method.md) as a runnable chain template |
| `create_project` | Create a project (workspace) you own |
| `list_projects` | List projects (workspaces) you have access to |
| `get_project` | Get a project by id, with the ids of its linked sessions |
| `list_meetings` | List personal calendar meetings captured by the Harmonica notetaker |
| `get_transcript` | Get the persisted transcript and speaker turns for a personal calendar meeting |
| `get_meeting_restrictions` | Get effective processing restrictions, pending candidates, and history for an owned meeting |
| `update_meeting_restrictions` | Set restrictions or review a pending transcript-derived candidate for an owned meeting |
| `update_project` | Rename a project or update its description (editor role) |
| `delete_project` | Soft-delete a project; contained sessions are left intact (owner role) |
| `create_unconference_topic` | Create a draft topic in an Unconference project and mirror it to the connected brain repository (editor access) |
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

- `HARMONICA_API_KEY` — API key from Harmonica dashboard. **Required for stdio, refused for HTTP** (see below).
- `HARMONICA_API_URL` (optional) — API base URL, defaults to `https://app.harmonica.chat`
- `MCP_TRANSPORT` (optional) — set to `http` to serve over HTTP. Anything else, or unset, means stdio.
- `MCP_ALLOWED_HOSTS` — comma-separated hostnames. **Required in HTTP mode.**
- `PORT` (optional) — HTTP mode only, defaults to 3000.

## HTTP transport

`MCP_TRANSPORT=http` (or `--http`) serves the same 26 tools over Streamable HTTP instead of stdio. **stdio remains the default**, so existing `npx -y harmonica-mcp` installs are untouched.

Each request carries its own key — `Authorization: Bearer <harmonica-api-key>` — and gets its own `HarmonicaClient` and its own server instance, so two callers with different keys can be in flight at once and nothing is shared between them.

| Route | Behaviour |
|---|---|
| `POST /mcp` | The MCP endpoint. Body cap → host allowlist → bearer check → dispatch. |
| `GET /healthz` | Liveness only. No auth, and deliberately no call to the Harmonica API, so an upstream outage cannot turn a platform health check red. |
| anything else | 404 |

**Two boot failures, and they are the load-bearing part of this design.** HTTP mode refuses to start if `HARMONICA_API_KEY` is set, or if `MCP_ALLOWED_HOSTS` is unset. Both misconfigurations are otherwise completely silent: a server booted with an env key works perfectly and serves every anonymous caller as the deploy owner's account; one booted without an allowlist works perfectly with no DNS-rebinding protection at all. Nothing downstream looks wrong in either case, so startup is the only place the mistake is still cheap. Do not soften either guard into a warning.

**Body cap.** `MAX_BODY_BYTES` (1 MiB) is enforced before routing and before auth, so an unauthenticated caller cannot make the process buffer an arbitrary payload. The memory bound is absolute; delivery of the 413 is best-effort, because closing a socket while a flood still has unread bytes in the kernel receive buffer produces an RST regardless of what userland does. That trade is deliberate and documented at the call site — a caller flooding the endpoint is owed a server that does not buffer it, not a tidy error.

**No host validation happens unless you call it.** The SDK exposes no `allowedHosts` option; `hostHeaderValidationResponse(req, hosts)` is a helper `src/http.ts` invokes itself. Removing that call silently removes the protection.

**SEP-2243 (`Mcp-Method` / `Mcp-Name` / `Mcp-Param-*`) needs nothing from this transport.** These are headers the *client* attaches to outbound requests on a 2026-07-28 connection. `createMcpHandler` validates their presence and cross-checks them against the JSON-RPC body inside its own dispatch ladder, which runs within `handler.fetch()` — already called for every `/mcp` request. The SDK emits no `Mcp-*` *response* headers, and that is correct rather than a gap.

**Testing note.** `Host` is a forbidden request-header name, so `fetch()` overwrites it with the real target. Any test that needs to send a spoofed `Host` must use `node:http.request`; written with `fetch` it will still pass while testing nothing.

## CI

`.github/workflows/ci.yml` — on push to `master`, on every PR, and **weekly on a schedule**.

- **test** — `npm ci && npm test` on Node 20 (the `engines` floor) and 24.
- **audit** — `npm audit --omit=dev --audit-level=high`, as a separate job so a red audit never hides test results.

Two deliberate choices. `--omit=dev` because this package is **published**: the gate is what a consumer inherits via `npx -y harmonica-mcp`, and failing on a dev-only advisory trains people to ignore the check. The **weekly schedule** is the part that actually catches drift — advisories get published against code that has not changed, so a push-only gate would never see them. That is precisely how nine advisories accumulated in the v1 SDK tree unnoticed.

The full audit including dev deps runs as an informational, non-blocking step, so a moderate advisory is still visible.

## Related Projects

- `harmonica-web-app/` — Main Harmonica platform (API source, defines `/api/v1/` endpoints)
- `harmonica-chat/` — Claude Code slash command for session creation (uses this MCP server)
- `harmonica-sync/` — CLI tool to sync sessions to markdown (uses the same REST API)
