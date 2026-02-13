# Harmonica MCP Server

MCP server enabling AI agents to access and query [Harmonica](https://harmonica.chat) sessions.

## Setup

```bash
npm install
npm run build
```

## Configuration

Set your API key and add to your MCP client config:

```json
{
  "mcpServers": {
    "harmonica": {
      "command": "node",
      "args": ["/path/to/harmonica-mcp/dist/index.js"],
      "env": {
        "HARMONICA_API_KEY": "hm_live_your_key_here"
      }
    }
  }
}
```

Generate an API key at [app.harmonica.chat](https://app.harmonica.chat) → Profile → API Keys, or via the API:

```bash
# Create a key (requires browser login session)
curl -X POST https://app.harmonica.chat/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "My MCP Key"}'
```

## Tools

| Tool | Description |
|------|-------------|
| `list_sessions` | List your deliberation sessions (filter by status, search) |
| `get_session` | Get full session details |
| `get_responses` | Get participant responses |
| `get_summary` | Get AI-generated summary |
| `search_sessions` | Search by topic or goal |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HARMONICA_API_KEY` | Yes | — | Your Harmonica API key |
| `HARMONICA_API_URL` | No | `https://app.harmonica.chat` | API base URL |

## Architecture

```
AI Agent → MCP Server (stdio) → Harmonica REST API → Neon Postgres
```

## License

MIT
