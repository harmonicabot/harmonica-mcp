# HAR-602 HTTP Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `harmonica-mcp` over Streamable HTTP with per-request API keys, alongside the existing stdio transport.

**Architecture:** Split the 780-line `src/index.ts` into `tools.ts` (definitions, pure), `http.ts` (Node server + SDK handler), and `index.ts` (bootstrap only). Tool handlers take a `HarmonicaClient` argument so each HTTP request runs against its own caller's key. Transport chosen by `MCP_TRANSPORT`; stdio stays the default.

**Tech Stack:** TypeScript, `@modelcontextprotocol/server` v2, zod 4, `node:http`, vitest. **No new dependencies.**

Design: `docs/plans/2026-08-03-har-602-http-transport-design.md` (commit `f83ff81`).

## Global Constraints

- **Node >= 20** — declared in `engines`. Do not use APIs newer than Node 20.
- **No new dependencies.** `createMcpHandler` returns a web-standard handler; `node:http` is sufficient. Express is NOT a dependency and must not become one.
- **stdio behaviour must not change.** The 35 existing tests pass untouched at every task boundary.
- **Never call `server.registerTool` directly.** Register through the local `tool()` helper, which wraps the shape in `z.object()` at one boundary. `src/index.test.ts` asserts there is exactly one `registerTool` call in the codebase — if you move it, update that test's path, do not weaken it.
- `npm test` runs `npm run build` first. Tests drive the built `dist/`, so always build before asserting.

### Verified SDK facts (do not re-derive)

- `createMcpHandler(factory, options?)` returns an **object**, not a function: `{ fetch, notify, bus, close }`. Call `handler.fetch(request)` → `Promise<Response>`.
- `McpRequestContext` is `{ era, authInfo?, requestInfo? }` where `requestInfo` is a web `Request`. This is how the factory reads per-request headers.
- There is **no `allowedHosts` option**. Host validation is `hostHeaderValidationResponse(req, allowedHostnames)` → `Response` (403) when rejected, `undefined` when allowed. It does nothing unless you call it.
- When the request `Accept` includes `text/event-stream`, the response body is SSE (`event: message\ndata: {...}`), not bare JSON. Tests must parse accordingly.

---

### Task 1: Extract tool definitions into `src/tools.ts`

A pure move. No behaviour change, no signature change. Doing it separately means Task 2's diff is only the client threading.

**Files:**
- Create: `src/tools.ts`
- Modify: `src/index.ts` (becomes bootstrap + re-export)
- Test: `src/index.test.ts` (path in the structural assertion)

**Interfaces:**
- Consumes: nothing.
- Produces: `src/tools.ts` exports `createServer(): McpServer` and `TOOLS_LIST_TTL_MS: number`.

- [ ] **Step 1: Run the suite to record the baseline**

```bash
npm test
```
Expected: 35 passed. Write the number down; it must not change in this task.

- [ ] **Step 2: Create `src/tools.ts` by moving lines from `index.ts`**

Move, verbatim: the `TOOLS_LIST_TTL_MS` constant, the `Registration` type, the `registrations` array, the `tool()` helper, all 21 `tool(...)` calls, and `createServer()`.

Header of the new file:

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { HarmonicaClient } from './client.js';
import { parseMethodSpec, toChainConfig } from './methodSpec.js';

export const TOOLS_LIST_TTL_MS = 60 * 60 * 1000;
```

`createServer` needs the package version, which `index.ts` reads from disk. Keep `tools.ts` free of filesystem access by taking it as a parameter:

```ts
export function createServer(version: string): McpServer {
  const server = new McpServer(
    { name: 'harmonica', version },
    { cacheHints: { 'tools/list': { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: 'public' } } },
  );
  for (const register of registrations) register(server);
  return server;
}
```

`client` is still the module-level one for now — leave the `const client = new HarmonicaClient(...)` in `index.ts` and import it into `tools.ts`. This is temporary and Task 2 removes it. Add at the top of `tools.ts`:

```ts
import { client } from './index.js';
```

**If that circular import trips at runtime, do not fight it** — instead move the client construction into `tools.ts` temporarily and import it from there in `index.ts`. Task 2 deletes it either way.

- [ ] **Step 3: Reduce `src/index.ts` to bootstrap**

```ts
#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { HarmonicaClient } from './client.js';
import { createServer } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const HARMONICA_API_URL = process.env.HARMONICA_API_URL || 'https://app.harmonica.chat';
const HARMONICA_API_KEY = process.env.HARMONICA_API_KEY;

if (!HARMONICA_API_KEY) {
  console.error('Error: HARMONICA_API_KEY environment variable is required.');
  console.error('Generate one at https://app.harmonica.chat (Profile → API Keys)');
  process.exit(1);
}

export const client = new HarmonicaClient({ baseUrl: HARMONICA_API_URL, apiKey: HARMONICA_API_KEY });

serveStdio(() => createServer(pkg.version), {
  onerror: (error) => {
    console.error('MCP transport error:', error);
  },
});
```

- [ ] **Step 4: Update the structural test's file path**

In `src/index.test.ts`, the "keeps every tool off the deprecated raw-shape path" test reads `index.ts`. Point it at `tools.ts`:

```ts
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tools.ts'), 'utf8');
```

Leave both assertions exactly as they are.

- [ ] **Step 5: Verify nothing changed**

```bash
npx tsc --noEmit && npm test
```
Expected: tsc clean, 35 passed — the same number as Step 1.

- [ ] **Step 6: Commit**

```bash
git add src/tools.ts src/index.ts src/index.test.ts
git commit -m "refactor: move tool definitions into src/tools.ts

Pure move ahead of HAR-602. index.ts keeps only bootstrap so the HTTP
transport has somewhere to attach. No behaviour change: 35 tests pass
unchanged, and the structural registerTool assertion now reads tools.ts."
```

---

### Task 2: Thread a per-request client through the tools

**Files:**
- Modify: `src/tools.ts` (the `tool()` helper, `createServer`, and all 21 handler signatures)
- Modify: `src/index.ts` (stop exporting `client`; pass it in)

**Interfaces:**
- Consumes: `createServer(version)` from Task 1.
- Produces: `createServer(client: HarmonicaClient, version: string): McpServer`. **Note the parameter order — client first.** Task 3 and Task 4 both call it.

- [ ] **Step 1: Change the `Registration` type and `tool()` helper**

In `src/tools.ts`:

```ts
type Registration = (server: McpServer, client: HarmonicaClient) => void;
const registrations: Registration[] = [];

function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  handler: (
    args: z.infer<z.ZodObject<S>>,
    client: HarmonicaClient,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
): void {
  registrations.push((server, client) => {
    server.registerTool(
      name,
      { description, inputSchema: z.object(shape) },
      ((args: z.infer<z.ZodObject<S>>) => handler(args, client)) as never,
    );
  });
}
```

- [ ] **Step 2: Change `createServer` to take the client**

```ts
export function createServer(client: HarmonicaClient, version: string): McpServer {
  const server = new McpServer(
    { name: 'harmonica', version },
    { cacheHints: { 'tools/list': { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: 'public' } } },
  );
  for (const register of registrations) register(server, client);
  return server;
}
```

Delete the module-level `client` import/const from `tools.ts`.

- [ ] **Step 3: Add the `client` parameter to all 21 handlers**

There are 19 destructuring handlers and 2 zero-argument ones.

```ts
async ({ session_id }) => {          // before
async ({ session_id }, client) => {  // after

async () => {                        // before  (2 of these)
async (_args, client) => {           // after
```

Handler bodies are unchanged — they already call `client.*`. Let `tsc` find any you miss.

- [ ] **Step 4: Update `index.ts` to pass the client**

Remove `export` from the `client` const, and:

```ts
serveStdio(() => createServer(client, pkg.version), { /* onerror as before */ });
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit && npm test
```
Expected: tsc clean, 35 passed. If tsc reports "Expected 1 arguments, but got 2" on a handler, that handler was missed in Step 3.

- [ ] **Step 6: Commit**

```bash
git add src/tools.ts src/index.ts
git commit -m "refactor: give each tool handler its own HarmonicaClient

Handlers took the module-level client built from the env key at load. HTTP
needs one client per request, so the client is now an explicit handler
argument rather than ambient module state. Two requests with different keys
can be in flight at once. stdio behaviour is unchanged."
```

---

### Task 3: `src/http.ts` — the HTTP server

**Files:**
- Create: `src/http.ts`
- Test: `src/http.test.ts`

**Interfaces:**
- Consumes: `createServer(client, version)` from Task 2.
- Produces: `startHttpServer(opts: HttpServerOptions): Promise<HttpServerHandle>` where

```ts
export interface HttpServerOptions {
  port: number;            // 0 selects an ephemeral port (tests rely on this)
  allowedHosts: string[];  // non-empty; Task 4 enforces that
  apiBaseUrl: string;
  version: string;
}
export interface HttpServerHandle {
  port: number;            // the ACTUAL bound port
  close: () => Promise<void>;
}
```

- [ ] **Step 1: Write the failing tests**

Create `src/http.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { startHttpServer, type HttpServerHandle } from './http.js';

let handle: HttpServerHandle | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

async function boot() {
  handle = await startHttpServer({
    port: 0,
    allowedHosts: ['127.0.0.1'],
    apiBaseUrl: 'https://app.harmonica.chat',
    version: '0.0.0-test',
  });
  return `http://127.0.0.1:${handle.port}`;
}

const RPC = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const ACCEPT = 'application/json, text/event-stream';

/** The SDK answers with SSE when text/event-stream is accepted, so unwrap it. */
function parseBody(text: string) {
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  return JSON.parse(line ? line.slice(6) : text);
}

describe('http transport', () => {
  it('rejects a request with no Authorization header', async () => {
    const base = await boot();
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: ACCEPT },
      body: JSON.stringify(RPC),
    });
    expect(res.status).toBe(401);
  });

  it('serves tools/list when a bearer key is supplied', async () => {
    const base = await boot();
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: ACCEPT,
        authorization: 'Bearer test-key-never-used-by-tools-list',
      },
      body: JSON.stringify(RPC),
    });
    expect(res.status).toBe(200);
    const body = parseBody(await res.text());
    expect(body.result.tools).toHaveLength(21);
  });

  it('rejects a Host outside the allowlist', async () => {
    const base = await boot();
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: ACCEPT,
        authorization: 'Bearer k',
        host: 'evil.example',
      },
      body: JSON.stringify(RPC),
    });
    expect(res.status).toBe(403);
  });

  it('serves /healthz without auth', async () => {
    const base = await boot();
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
  });

  it('404s an unknown path', async () => {
    const base = await boot();
    const res = await fetch(`${base}/nope`, { headers: { authorization: 'Bearer k' } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/http.test.ts
```
Expected: FAIL — cannot resolve `./http.js`.

- [ ] **Step 3: Implement `src/http.ts`**

```ts
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createMcpHandler, hostHeaderValidationResponse } from '@modelcontextprotocol/server';
import { HarmonicaClient } from './client.js';
import { createServer } from './tools.js';

export interface HttpServerOptions {
  port: number;
  allowedHosts: string[];
  apiBaseUrl: string;
  version: string;
}

export interface HttpServerHandle {
  port: number;
  close: () => Promise<void>;
}

/** `Authorization: Bearer <key>` → the key, or null when absent or malformed. */
function bearerFrom(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const key = match?.[1]?.trim();
  return key ? key : null;
}

function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value != null) headers.set(name, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, { method: req.method, headers, body: hasBody ? body : undefined });
}

async function writeWebResponse(res: ServerResponse, web: Response): Promise<void> {
  res.statusCode = web.status;
  web.headers.forEach((value, name) => res.setHeader(name, value));
  if (!web.body) {
    res.end();
    return;
  }
  const reader = web.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

export async function startHttpServer(opts: HttpServerOptions): Promise<HttpServerHandle> {
  // The factory re-reads the header rather than closing over a key: createMcpHandler is built
  // once, but must produce a server bound to THIS request's caller.
  const handler = createMcpHandler(
    (ctx) => {
      const key = ctx.requestInfo ? bearerFrom(ctx.requestInfo) : null;
      // Unreachable — routing rejects a missing key with 401 before we get here. Throwing rather
      // than falling back to an env key is deliberate: a silent fallback would serve an
      // anonymous caller as the deploy's own account.
      if (!key) throw new Error('missing bearer token');
      const client = new HarmonicaClient({ baseUrl: opts.apiBaseUrl, apiKey: key });
      return createServer(client, opts.version);
    },
    { onerror: (error) => console.error('MCP handler error:', error) },
  );

  const server = createHttpServer((req, res) => {
    void (async () => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const webReq = toWebRequest(req, Buffer.concat(chunks));
        const { pathname } = new URL(webReq.url);

        if (pathname === '/healthz') {
          // No auth and no upstream call: an outage at the Harmonica API must not make the
          // platform think this process is dead.
          await writeWebResponse(res, json(200, { status: 'ok', version: opts.version }));
          return;
        }
        if (pathname !== '/mcp') {
          await writeWebResponse(res, json(404, { error: 'not found' }));
          return;
        }

        const hostRejection = hostHeaderValidationResponse(webReq, opts.allowedHosts);
        if (hostRejection) {
          await writeWebResponse(res, hostRejection);
          return;
        }

        if (!bearerFrom(webReq)) {
          await writeWebResponse(
            res,
            new Response(JSON.stringify({ error: 'missing or malformed Authorization: Bearer <harmonica-api-key>' }), {
              status: 401,
              headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
            }),
          );
          return;
        }

        await writeWebResponse(res, await handler.fetch(webReq));
      } catch (error) {
        console.error('request failed:', error);
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      }
    })();
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : opts.port);
    });
  });

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        void handler.close();
        server.close(() => resolve());
      }),
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
npm run build && npx vitest run src/http.test.ts
```
Expected: 5 passed.

- [ ] **Step 5: Check SEP-2243 rather than assuming**

Probing showed the SDK emits no `Mcp-*` **response** headers. Confirm whether `Mcp-Method` / `Mcp-Name` are a client-side request obligation (in which case this server has nothing to do) or a server response obligation (in which case add them in `writeWebResponse`). Record the answer in `CLAUDE.md` under the MCP SDK v2 section either way — the next person will ask the same question.

- [ ] **Step 6: Commit**

```bash
git add src/http.ts src/http.test.ts
git commit -m "feat: HTTP transport with per-request bearer API keys

POST /mcp and GET /healthz on node:http; no new dependencies. Each request's
Authorization: Bearer key builds its own HarmonicaClient, so callers act as
themselves.

Host validation is explicit: the SDK has no allowedHosts option and does
nothing unless hostHeaderValidationResponse is called, so an unvalidated
deploy would be open to DNS rebinding."
```

---

### Task 4: Bootstrap — transport switch and the two boot failures

**Files:**
- Modify: `src/index.ts`
- Test: `src/index.test.ts` (append a boot-failure block)

**Interfaces:**
- Consumes: `startHttpServer` (Task 3), `createServer` (Task 2).
- Produces: the shipped CLI behaviour.

- [ ] **Step 1: Write the failing tests**

Append to `src/index.test.ts`:

```ts
import { spawnSync } from 'node:child_process';

/** Boot the built binary with a given env and return exit code + stderr. */
function boot(env: Record<string, string | undefined>) {
  const result = spawnSync(process.execPath, [ENTRY], {
    env: { ...process.env, HARMONICA_API_KEY: undefined, MCP_TRANSPORT: undefined, ...env },
    encoding: 'utf8',
    timeout: 15_000,
    input: '',
  });
  return { code: result.status, stderr: result.stderr ?? '' };
}

describe('boot guards', () => {
  it('refuses HTTP mode when HARMONICA_API_KEY is set', () => {
    // The failure this prevents is silent: a shared env key would make every anonymous
    // caller act as the deploy's own Harmonica account.
    const { code, stderr } = boot({
      MCP_TRANSPORT: 'http',
      MCP_ALLOWED_HOSTS: 'example.com',
      HARMONICA_API_KEY: 'leftover-from-stdio-config',
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/HARMONICA_API_KEY/);
  });

  it('refuses HTTP mode without MCP_ALLOWED_HOSTS', () => {
    const { code, stderr } = boot({ MCP_TRANSPORT: 'http' });
    expect(code).toBe(1);
    expect(stderr).toMatch(/MCP_ALLOWED_HOSTS/);
  });

  it('still requires HARMONICA_API_KEY for stdio', () => {
    const { code, stderr } = boot({});
    expect(code).toBe(1);
    expect(stderr).toMatch(/HARMONICA_API_KEY/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run build && npx vitest run src/index.test.ts -t "boot guards"
```
Expected: FAIL — HTTP mode does not exist yet, so the first two do not exit 1 for the stated reason.

- [ ] **Step 3: Implement the bootstrap**

Replace the env/transport section of `src/index.ts`:

```ts
const HARMONICA_API_URL = process.env.HARMONICA_API_URL || 'https://app.harmonica.chat';
const HARMONICA_API_KEY = process.env.HARMONICA_API_KEY;

const useHttp = process.env.MCP_TRANSPORT === 'http' || process.argv.includes('--http');

function die(...lines: string[]): never {
  for (const line of lines) console.error(line);
  process.exit(1);
}

if (useHttp) {
  // Refusing rather than ignoring. An env key here would be used for every caller, which is
  // exactly what per-request auth exists to prevent, and nothing downstream would look wrong.
  if (HARMONICA_API_KEY) {
    die(
      'Error: HARMONICA_API_KEY must NOT be set when MCP_TRANSPORT=http.',
      'In HTTP mode each caller supplies its own key via `Authorization: Bearer <key>`.',
      'A server-side key would make every caller act as that one account. Unset it.',
    );
  }
  const allowed = (process.env.MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (allowed.length === 0) {
    die(
      'Error: MCP_ALLOWED_HOSTS is required when MCP_TRANSPORT=http.',
      'Comma-separated hostnames this server answers for, e.g. mcp.harmonica.chat',
      'Without it there is no DNS-rebinding protection.',
    );
  }

  const { startHttpServer } = await import('./http.js');
  const handle = await startHttpServer({
    port: Number(process.env.PORT ?? 3000),
    allowedHosts: allowed,
    apiBaseUrl: HARMONICA_API_URL,
    version: pkg.version,
  });
  console.error(`harmonica-mcp ${pkg.version} listening on :${handle.port} (hosts: ${allowed.join(', ')})`);
} else {
  if (!HARMONICA_API_KEY) {
    die(
      'Error: HARMONICA_API_KEY environment variable is required.',
      'Generate one at https://app.harmonica.chat (Profile → API Keys)',
    );
  }
  const client = new HarmonicaClient({ baseUrl: HARMONICA_API_URL, apiKey: HARMONICA_API_KEY });
  serveStdio(() => createServer(client, pkg.version), {
    onerror: (error) => console.error('MCP transport error:', error),
  });
}
```

Top-level `await` requires `"module": "es2022"` or later in `tsconfig.json`. If tsc objects, wrap the HTTP branch in an async IIFE rather than changing the module target.

- [ ] **Step 4: Run the full suite**

```bash
npm test
```
Expected: 43 passed (35 + 5 http + 3 boot guards).

- [ ] **Step 5: Smoke it by hand**

```bash
MCP_TRANSPORT=http MCP_ALLOWED_HOSTS=127.0.0.1 PORT=8181 node dist/index.js &
curl -s localhost:8181/healthz
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8181/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
Expected: `{"status":"ok",...}` then `401`. Kill the process afterwards.

- [ ] **Step 6: Document and commit**

Add an `## HTTP transport` section to `CLAUDE.md` covering the env vars, both boot guards and why they exist, and the two routes. Then:

```bash
git add src/index.ts src/index.test.ts CLAUDE.md
git commit -m "feat: MCP_TRANSPORT=http switch, with two deliberate boot failures

stdio remains the default, so existing installs are unaffected.

HTTP mode refuses to start if HARMONICA_API_KEY is set, or if
MCP_ALLOWED_HOSTS is unset. Both misconfigurations are silent otherwise and
both end with one account serving every anonymous caller."
```

---

### Task 5: Deploy to Railway

Confirm with Artem before creating the service — this is the first outward-facing piece and the domain is his call.

**Files:**
- Modify: `CLAUDE.md` (deployment section)

- [ ] **Step 1: Create the service**

Railway project: the Harmonica ecosystem project, per the workspace convention that Harmonica services run on Railway. Deploy from `harmonicabot/harmonica-mcp`, branch `master`.

Variables — note what is deliberately absent:

```
MCP_TRANSPORT=http
MCP_ALLOWED_HOSTS=<the generated Railway domain>
HARMONICA_API_URL=https://app.harmonica.chat
# HARMONICA_API_KEY is deliberately NOT set. Setting it makes the service refuse to boot.
```

`PORT` is injected by Railway; do not set it.

- [ ] **Step 2: Verify the deploy from outside**

```bash
curl -s https://<domain>/healthz
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<domain>/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -s -X POST https://<domain>/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H "authorization: Bearer $REAL_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 200
```
Expected: `ok`, then `401`, then 21 tools.

- [ ] **Step 3: Prove the boot guard fires in the real environment**

Temporarily set `HARMONICA_API_KEY` in Railway and confirm the deploy **fails** with the expected message, then remove it. A guard that has only ever been tested locally is a guard nobody has tested.

- [ ] **Step 4: Record the deployment and close the issue**

Add the domain and variables to `CLAUDE.md`, commit, and comment on HAR-602 with the URL, the client config snippet, and the note that it is superseded by HAR-484.

---

## Self-review

**Spec coverage:** per-request bearer auth → Tasks 2, 3. Mode switch, stdio default → Task 4. Both boot failures → Task 4. `POST /mcp` + `GET /healthz` → Task 3. Host validation → Task 3. Three-file split → Tasks 1, 3, 4. No new deps → Global Constraints. SEP-2243 → Task 3 Step 5. Railway → Task 5. Out-of-scope items (OAuth, scale, rate limiting) have no tasks, correctly.

**Types:** `createServer(client, version)` is defined in Task 2 and used with that order in Tasks 3 and 4. `HttpServerOptions` / `HttpServerHandle` are defined in Task 3 and consumed in Task 4. `bearerFrom` is used in two places within Task 3 only.

**Known wrinkle:** Task 1 Step 2 introduces a temporary circular import that Task 2 removes. Called out in the step with a fallback, rather than left to be discovered.
