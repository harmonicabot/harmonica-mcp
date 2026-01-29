# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server for Harmonica, enabling AI agents to access and query Harmonica deliberation sessions programmatically.

## Use Cases

- AI agents querying session results for research/analysis
- Cross-pollination between external AI systems and Harmonica sessions
- Automated session summarization and reporting
- Integration with other governance tools

## Planned Tools

### Read Operations
- `list_sessions` - List sessions (filter by host, status, date range)
- `get_session` - Get session details (questions, settings, participant count)
- `get_responses` - Get responses for a session/question
- `get_summary` - Get AI-generated session summary
- `search_sessions` - Search across sessions by content

### Write Operations (future)
- `create_session` - Create a new session programmatically
- `add_response` - Submit a response to a session

## Architecture

- TypeScript MCP server using `@modelcontextprotocol/sdk`
- Connects to Harmonica's Supabase backend
- Authentication via API key or service account

## Related Projects

- `harmonica-web-app/` - Main Harmonica platform (Supabase schema reference)
- `avatar-sdk/` - CAP protocol (similar MCP server patterns)

## Task Persistence

Tasks persist to `~/.claude/tasks/harmonica-mcp/`
