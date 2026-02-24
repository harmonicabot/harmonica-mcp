# harmonica-sync — Design Doc

**Date:** 2026-02-24
**Status:** Approved
**Related:** HAR-209 (webhooks), HAR-210 (session tags)

## Problem

Harmonica hosts running research, community deliberation, or recurring sessions want their session results to automatically flow into a structured repository (GitHub, GitLab, etc.) for analysis, publishing, or archival. Today this requires writing a custom script per use case — see `needs-discovery/.github/scripts/sync-sessions.js` for the NSRT prototype.

## Solution

Publish `harmonica-sync` as a standalone npm package. Hosts run `npx harmonica-sync` in CI or locally to pull completed sessions from the Harmonica API and write them as templated markdown files.

## Audience

- **Primary:** Technical community organizers who set up the automation
- **Secondary:** Non-technical community members who benefit from the structured output (browsable session results in a repo, Quartz wiki, static site)

## CLI Interface

```
npx harmonica-sync                     # uses ./harmonica.config.json
npx harmonica-sync --config path/to    # custom config path
npx harmonica-sync --init              # generates starter config + template
```

**Environment variables:**
- `HARMONICA_API_KEY` (required) — API key from Harmonica dashboard
- `HARMONICA_API_URL` (optional) — defaults to `https://app.harmonica.chat`

## Config File (`harmonica.config.json`)

```json
{
  "sync": {
    "search": ["NSRT", "neighborhood tools"],
    "keywords": ["nsrt", "novi sad", "neighborhood"],
    "minParticipants": 1,
    "requireSummary": true
  },
  "output": {
    "dir": "sessions",
    "filename": "{{date}}-{{id}}.md",
    "template": "./session-template.md"
  }
}
```

### Config Fields

- **`sync.search`** — API search queries (how to find sessions). Array of strings.
- **`sync.keywords`** — Relevance filter on topic/goal text (confirm sessions are actually yours). Optional — if omitted, all search results are accepted.
- **`sync.tags`** — (future, after HAR-210) Filter by session tags via API. Cleaner than keyword matching.
- **`sync.minParticipants`** — Skip sessions with fewer participants. Default: 1.
- **`sync.requireSummary`** — Only sync sessions that have a generated summary. Default: true.
- **`output.dir`** — Directory to write session files. Default: `sessions`.
- **`output.filename`** — Filename template. Available variables: `{{date}}`, `{{id}}`, `{{slug}}` (sanitized topic). Default: `{{date}}-{{id}}.md`.
- **`output.template`** — Path to a Mustache template file for session markdown. Ships with a Quartz-compatible default.

## Template System

Default template is Quartz/Hugo/Jekyll-compatible with YAML frontmatter:

```mustache
---
title: "{{topic}}"
date: {{date}}
session_id: {{id}}
participants: {{participant_count}}
status: {{status}}
tags:
{{#tags}}
  - {{.}}
{{/tags}}
---

# {{topic}}

**Goal:** {{goal}}
{{#critical}}
**Critical Question:** {{critical}}
{{/critical}}

{{#context}}
## Context

{{context}}
{{/context}}

{{#summary}}
## Summary

{{summary}}
{{/summary}}

{{#responses}}
## Participant Responses

{{#participants}}
### Participant {{number}}

{{#messages}}
> {{content}}

{{/messages}}
{{/participants}}
{{/responses}}
```

### Template Variables

| Variable | Type | Description |
|----------|------|-------------|
| `topic` | string | Session topic |
| `date` | string | ISO date (YYYY-MM-DD) |
| `id` | string | Session ID (hst_...) |
| `participant_count` | number | Number of participants |
| `status` | string | Session status |
| `goal` | string | Session goal |
| `critical` | string/null | Critical question |
| `context` | string/null | Session context |
| `summary` | string/null | AI-generated summary |
| `tags` | string[] | Matched search queries (heuristic until HAR-210) |
| `responses` | boolean | Whether responses exist |
| `responses.participants` | array | Participant response objects |
| `responses.participants[].number` | number | Participant number (1-indexed) |
| `responses.participants[].messages` | array | User messages |

## `--init` Scaffolding

Running `npx harmonica-sync --init` generates:

- `harmonica.config.json` — starter config with placeholder search queries
- `session-template.md` — copy of the default Quartz-compatible template

Prints setup instructions for the host.

## Architecture

```
harmonica-sync/
  src/
    cli.ts          # arg parsing, --init scaffolding
    sync.ts         # core sync logic (fetch, filter, dedupe)
    api.ts          # Harmonica API client
    template.ts     # Mustache template rendering
  templates/
    session-template.md   # default Quartz-compatible template
  package.json      # bin: { "harmonica-sync": "./dist/cli.js" }
```

### API Client

The API client is the same HTTP code as `harmonica-mcp/src/client.ts` — copy the relevant functions (`listSessions`, `getSession`, `getResponses`, `getSummary`, `searchSessions`). If both packages grow, extract a shared `harmonica-api` core later.

### Sync Logic

1. Read config file
2. Load existing session IDs from output directory (idempotency)
3. Search Harmonica API with each query in `sync.search`
4. Filter candidates by `sync.keywords` (topic/goal text matching)
5. For each candidate: check summary exists, check participant count
6. Fetch full session details + responses
7. Render through Mustache template
8. Write to output directory

### Dependencies

- `mustache` — template rendering (lightweight, well-known)
- No other runtime dependencies (uses native `fetch`)

## Upgrade Path

1. **v1 (now):** Keyword matching on topic/goal text. Works but fuzzy.
2. **v2 (after HAR-210):** Add `sync.tags` config option, filter via `GET /sessions?tag=x`. Clean and precise.
3. **v3 (after HAR-209):** Optional webhook mode — instead of polling on a schedule, Harmonica pushes events to a webhook that triggers the sync.

## Example CI Usage

### GitHub Actions

```yaml
name: Sync Harmonica Sessions
on:
  schedule:
    - cron: '0 */6 * * *'
  workflow_dispatch:
permissions:
  contents: write
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Sync sessions
        env:
          HARMONICA_API_KEY: ${{ secrets.HARMONICA_API_KEY }}
        run: npx harmonica-sync
      - name: Commit new sessions
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add sessions/
          git diff --cached --quiet || git commit -m "Sync Harmonica sessions" && git push
```

## Origin

This design generalizes the prototype built for NSRelaTech/needs-discovery (Feb 2026), which syncs NSRT community deliberation sessions into a research repo.
