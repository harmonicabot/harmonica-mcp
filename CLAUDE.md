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

No test suite. No linter configured.

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

Two source files:
- `src/index.ts` — MCP server entry point. Registers tools with zod schemas, starts stdio transport.
- `src/client.ts` — HTTP client wrapping the Harmonica REST API. All methods throw on HTTP errors.

## MCP Tools (exposed in index.ts)

| Tool | Description |
|------|-------------|
| `create_session` | Create a new session and get a shareable join URL |
| `update_session` | Update session metadata (topic, goal, context, critical, prompt) |
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

## Client methods NOT yet exposed as tools

`client.ts` has additional methods with no corresponding MCP tool:
- `getMe()` — current user info
- `submitResponse(sessionId, content)` — submit a response (non-conversational)

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
