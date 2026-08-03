import { describe, it, expect, afterEach } from 'vitest';
import { request as httpRequest } from 'node:http';
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

  // `Host` is a forbidden request-header name (WHATWG Fetch spec), so `fetch` silently overwrites
  // it with the real connection target before the request goes on the wire — the server never
  // sees the spoofed value. `node:http.request` can actually put an arbitrary Host on the wire, so
  // it's the only way to exercise the allowlist-rejection path. Do not "tidy" this back to `fetch`:
  // it would still pass (a legitimate Host is in the allowlist) while silently testing nothing.
  it('rejects a Host outside the allowlist', async () => {
    await boot();
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: handle!.port,
          path: '/mcp',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: ACCEPT,
            authorization: 'Bearer k',
            host: 'evil.example',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(RPC));
    });
    expect(status).toBe(403);
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
