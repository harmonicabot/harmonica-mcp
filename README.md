# Harmonica MCP Server

MCP server enabling AI agents to access and query [Harmonica](https://harmonica.chat) deliberation sessions.

## Status

**Blocked** — waiting on Harmonica REST API to be built in [harmonica-web-app](https://github.com/harmonicabot/harmonica-web-app).

> "MCP servers just manage how to access the API basically. We would need to have that first." — Jonas, OFL Stewards Call (Nov 2025)

## Architecture

```
AI Agent → MCP Server (this project) → Harmonica REST API → Neon Postgres
```

The MCP server is a **client** of the Harmonica REST API. The API must exist first — it will also serve Slack bots, mobile apps, and other integrations.

## Planned API Endpoints (Prerequisites)

These need to be built in harmonica-web-app as Next.js API routes:

| Endpoint | Description |
|----------|-------------|
| `GET /api/sessions` | List sessions with filters |
| `GET /api/sessions/:id` | Session details |
| `GET /api/sessions/:id/questions` | Questions |
| `GET /api/sessions/:id/responses` | Responses |
| `POST /api/sessions/:id/responses` | Submit response |
| `GET /api/sessions/:id/summary` | Summary |

## Planned MCP Tools

| Tool | Description |
|------|-------------|
| `list_sessions` | List sessions with filters |
| `get_session` | Get session details |
| `get_responses` | Get responses for a session |
| `get_summary` | Get session summary |
| `search_sessions` | Search across sessions |

## Tech Stack

- TypeScript
- `@modelcontextprotocol/sdk`
- Harmonica REST API (client)

## License

MIT
