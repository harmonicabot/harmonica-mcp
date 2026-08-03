# HAR-602 — Streamable HTTP transport alongside stdio

Design, 2026-08-03. Approved before implementation.

## Purpose

Web-based MCP clients cannot spawn a local process, so they need a URL. Today `harmonica-mcp` is stdio-only: `npx -y harmonica-mcp` with `HARMONICA_API_KEY` in the environment.

This adds an HTTP transport to the published package, so anyone running their own instance can serve it over a URL.

**Scope narrowed 2026-08-03.** Harmonica's own hosted endpoint is HAR-1376's job: a streamable-HTTP MCP inside Pro, calling the server libs in-process, with Auth0 OAuth in its second slice. That is the only path that reaches Claude.ai custom connectors, and standing up a second hosted endpoint here would duplicate it with a strictly worse implementation — a network hop back to `/api/v1` instead of an in-process call. So this design keeps the transport and drops the deployment. (The framing below originally named HAR-484 as the successor. HAR-1376 is the live one; HAR-484 is the older exploration.)

## Corrections to HAR-602's implementation notes

The issue was written 2026-04-03 and three of its notes are now wrong. They are recorded here because two of them changed the design.

| Issue said | Actual |
|---|---|
| "Express is already a dependency" | It is not. Deps are `@modelcontextprotocol/server`, `js-yaml`, `zod`. And none is needed — `createMcpHandler` returns a web-standard handler, so `node:http` suffices. |
| "SDK v1.12.0 includes `StreamableHTTPServerTransport`" | We are on SDK v2 as of 0.13.0. The entry point is `createMcpHandler(factory, options)`. |
| Session affinity is the main cost | Removed by the stateless core (SEP-2575/SEP-2567). The v2 factory already receives a per-request context, so per-request auth is a small change rather than a restructure. |

**There is no `allowedHosts` option.** `CreateMcpHandlerOptions` exposes only `legacy`, `onerror`, `responseMode`, `bus`, `maxSubscriptions`, `keepAliveMs`. Host validation is a helper you invoke yourself: `hostHeaderValidationResponse(req, allowedHostnames): Response | undefined`. DNS-rebinding protection therefore does not merely default off — it does not happen at all unless called.

## Decisions

**Auth: per-request API key.** Each caller sends its own Harmonica key as `Authorization: Bearer <key>`; a client is constructed per request. No OAuth — that is HAR-1376's job, and building it here means building it twice. Nothing is wasted, because HAR-1376 needs the same per-request identity.

**Transport selection: one binary, mode switch.** `MCP_TRANSPORT=http` or `--http`; stdio otherwise. One published artifact, default unchanged, self-hosters gain HTTP for free. Rejected: a second `bin` (two artifacts to keep in step) and a separate deploy repo (duplicated wiring, published package gains nothing).

## Architecture

Three files, replacing one 780-line entrypoint:

| File | Responsibility | Depends on |
|---|---|---|
| `src/tools.ts` | The 21 tool definitions and `createServer(client)`. Pure — no env reads, no side effects, no transport. | `HarmonicaClient`, zod, SDK |
| `src/http.ts` | `startHttpServer({ port, allowedHosts })`. `node:http` + `createMcpHandler`. | `tools.ts` |
| `src/index.ts` | Bootstrap only: read env, pick transport, wire it. | both |

No new dependencies.

### The one real refactor

Handlers currently close over a module-level `client` built from the env key at load time. Per-request auth requires each handler to use its own, so the `tool()` helper gains a client parameter and all 21 handler signatures change:

```ts
async ({ session_id }) => { … client.getSession(session_id) … }        // before
async ({ session_id }, client) => { … client.getSession(session_id) … } // after
```

Bodies are unchanged — they already call `client.*`. This makes the dependency explicit rather than ambient, which is what allows two requests with different keys to be in flight at once.

## Routes

| Route | Purpose |
|---|---|
| `POST /mcp` | The MCP endpoint. What goes in a client's config. |
| `GET /healthz` | Liveness only — returns 200 with no auth and no dependency on the Harmonica API, so a platform health check cannot be turned red by an upstream outage. |

Any other path returns 404. `/mcp` rather than `/` so the health check and the protocol endpoint never collide.

## Request flow (HTTP)

1. Validate `Host` against the allowlist → 403 if it fails.
2. Extract `Authorization: Bearer <key>` → 401 if absent or malformed.
3. Construct `HarmonicaClient` for that key.
4. `createServer(client)` — a fresh server per request.
5. Tool runs against the caller's own Harmonica account.

No state is shared between requests.

## Configuration

| Variable | Behaviour |
|---|---|
| `MCP_TRANSPORT=http` (or `--http`) | Selects HTTP. **stdio remains the default**, so existing installs are unaffected. |
| `PORT` | Supplied by Railway; 3000 otherwise. |
| `MCP_ALLOWED_HOSTS` | Comma-separated hostnames. **Boot fails in HTTP mode if unset** — no permissive default. |
| `HARMONICA_API_KEY` | Required for stdio. **Refused in HTTP mode** — boot fails with an explicit message. |
| `HARMONICA_API_URL` | Unchanged. |

The two boot failures are the load-bearing part of this design. A hosted endpoint that silently falls back to a single env key would serve every anonymous caller as that account — the exact failure per-request auth exists to prevent. Failing loudly at startup is the only reliable guard, because nothing downstream would look wrong.

## Error handling

| Condition | Response |
|---|---|
| `Host` not in allowlist | 403 via `hostHeaderValidationResponse` |
| Missing or malformed `Authorization` | 401, MCP-shaped |
| Harmonica API rejects the key | Unchanged — surfaces as tool-level error text |
| Transport error | `onerror` logs to stderr; process stays up |

## Testing

The 35 existing tests must keep passing untouched — stdio behaviour does not change.

New tests boot the server on an ephemeral port and assert:

- 401 when no `Authorization` header is sent.
- 21 tools returned when one is.
- 403 for a `Host` outside the allowlist.
- **Boot fails when `HARMONICA_API_KEY` is set in HTTP mode.**
- **Boot fails when `MCP_ALLOWED_HOSTS` is unset in HTTP mode.**

The last two matter most. Everything else fails visibly in normal use; those two fail silently and serve every caller as one account.

## Also in scope

`Mcp-Method` / `Mcp-Name` headers (SEP-2243), deferred from HAR-1451 as HTTP-only. Verify whether `createMcpHandler` emits them before writing any.

## Out of scope

- **OAuth** — HAR-1376 (slice 2).
- **Multi-instance / horizontal scale** — the stateless core permits it; nothing needs it yet.
- **Rate limiting** — the Harmonica API already limits per key, and every caller here is authenticated as themselves.

## Deployment

**None from this issue.** Harmonica's hosted endpoint is HAR-1376's slice 1.

What ships here is the capability, not an instance: a self-hoster sets `MCP_TRANSPORT=http` and `MCP_ALLOWED_HOSTS`, leaves `HARMONICA_API_KEY` unset, and runs it wherever they like. The two boot failures above are what make that safe to do unattended — they are the whole reason this is publishable rather than a local experiment.
