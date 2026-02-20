# Harmonica MCP Server

[![npm version](https://img.shields.io/npm/v/harmonica-mcp)](https://www.npmjs.com/package/harmonica-mcp)

MCP server enabling AI agents to create and query [Harmonica](https://harmonica.chat) deliberation sessions.

[Harmonica](https://harmonica.chat) is a structured deliberation platform where groups coordinate through AI-facilitated async conversations. Create a session with a topic and goal, share a link with participants, and each person has a private 1:1 conversation with an AI facilitator. Responses are synthesized into actionable insights.

## Quick Start

### npx (no install)

```json
{
  "mcpServers": {
    "harmonica": {
      "command": "npx",
      "args": ["-y", "harmonica-mcp"],
      "env": {
        "HARMONICA_API_KEY": "hm_live_your_key_here"
      }
    }
  }
}
```

### From source

```bash
git clone https://github.com/harmonicabot/harmonica-mcp.git
cd harmonica-mcp
npm install && npm run build
```

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

### Get an API key

1. [Sign up for Harmonica](https://app.harmonica.chat) (free)
2. Go to [Profile](https://app.harmonica.chat/profile) > **API Keys** > **Generate API Key**
3. Copy your `hm_live_...` key — it's only shown once

## Tools

| Tool | Description |
|------|-------------|
| `create_session` | Create a new deliberation session and get a shareable join URL |
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

## License

MIT
