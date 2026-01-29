# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server for Harmonica, enabling AI agents to access and query Harmonica deliberation sessions programmatically.

**Important:** This project depends on a Harmonica REST API that doesn't exist yet. The API must be built first in `harmonica-web-app/`, then this MCP server will be a client of that API.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AI Agents     │     │   Slack Bot     │     │    Web App      │
│  (Claude, etc)  │     │  (future)       │     │   (current)     │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Harmonica REST API                          │
│            (to be built in harmonica-web-app)                   │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │   Neon (Postgres)   │
                    └─────────────────────┘
```

- **harmonica-mcp/** - This repo: MCP server using `@modelcontextprotocol/sdk`
- **harmonica-web-app/** - Where the API will be built (Next.js API routes)
- Both connect to the same Neon Postgres database

## Prerequisite: Harmonica API

Before this MCP server can be built, the API needs to exist:
- `GET /api/sessions` - list sessions with filters
- `GET /api/sessions/:id` - session details
- `GET /api/sessions/:id/questions` - questions
- `GET /api/sessions/:id/responses` - responses
- `POST /api/sessions/:id/responses` - submit response
- `GET /api/sessions/:id/summary` - summary

This same API will also enable:
- Slack/Discord chatbots for participants
- Mobile apps
- Zapier/webhook integrations

## MCP Tools (planned)

Once the API exists, this server will expose:
- `list_sessions` - List sessions with filters
- `get_session` - Get session details
- `get_responses` - Get responses for a session
- `get_summary` - Get session summary
- `search_sessions` - Search across sessions

## Related Projects

- `harmonica-web-app/` - Main Harmonica platform (Neon Postgres schema reference)
- `avatar-sdk/` - CAP protocol (similar MCP server patterns)

## Task Persistence

Tasks persist to `~/.claude/tasks/harmonica-mcp/`

## Context

From OFL Stewards Call (Nov 2025), Jonas noted: "MCP servers just manage how to access the API basically. We would need to have that first."

James (Harry's brother) made the same point about Slack chatbots - Harmonica's architecture has too much hardcoded, making it impossible to build alternative interfaces without a proper API layer.
