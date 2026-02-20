# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server for Harmonica, enabling AI agents to access and query Harmonica deliberation sessions programmatically.

## Commands

```bash
npm run build   # Compile TypeScript → dist/
npm run dev     # Watch mode compilation
npm start       # Run the MCP server (requires HARMONICA_API_KEY env var)
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

This is a **client** of the Harmonica REST API (`/api/v1/`), which lives in `harmonica-web-app/`.

## Project Structure

```
src/
  index.ts    # MCP server entry point — registers tools, starts stdio transport
  client.ts   # HTTP client for Harmonica REST API v1
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `create_session` | Create a new session and get a shareable join URL |
| `list_sessions` | List sessions with optional status filter and search |
| `get_session` | Get full session details by ID |
| `get_responses` | Get participant responses for a session |
| `get_summary` | Get AI-generated session summary |
| `search_sessions` | Search sessions by topic/goal keywords |

## Environment Variables

- `HARMONICA_API_KEY` (required) — API key from Harmonica dashboard
- `HARMONICA_API_URL` (optional) — API base URL, defaults to `https://app.harmonica.chat`

## Configuration

Add to Claude Code config (`~/.claude.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "harmonica": {
      "command": "node",
      "args": ["/path/to/harmonica-mcp/dist/index.js"],
      "env": {
        "HARMONICA_API_KEY": "hm_live_..."
      }
    }
  }
}
```

## Related Projects

- `harmonica-web-app/` — Main Harmonica platform (API source)
- `avatar-sdk/` — CAP protocol (similar MCP patterns)
