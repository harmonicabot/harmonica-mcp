import { describe, it, expect, afterEach } from 'vitest';
import { request as httpRequest } from 'node:http';
import { startHttpServer, MAX_BODY_BYTES, type HttpServerHandle } from './http.js';

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
    expect(body.result.tools).toHaveLength(24);
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

  // The fast path rejects purely on the DECLARED Content-Length header, before ever touching the
  // request stream — so this sends a header that overstates the body (declares MAX_BODY_BYTES + 1,
  // actually sends a few bytes) instead of a genuinely oversized one. That is deliberate, not a
  // shortcut: an earlier version of this test sent a real MAX_BODY_BYTES + 1 byte body via `fetch`
  // with a matching Content-Length, and it was flaky (~1 failure in 20 runs). Closing a socket
  // while a real flood still has unread bytes sitting in the kernel receive buffer produces a
  // client-visible ECONNRESET instead of the 413 — and larger floods (5x/20x/100x the cap) hit this
  // essentially every time, with or without draining, regardless of what userland does. The server
  // cannot tell "declared X, about to send X" from "declared X, sending less" until it starts
  // reading the stream — which the fast path never does — so this exercises the exact same code
  // path with zero bytes of real flood and zero observed flakiness (0/60+ in local stress runs; see
  // the task report for the 20-consecutive-run evidence this was gated on before merge). Do not
  // "fix" this by sending a body that matches the declared length — that reintroduces the flake
  // this comment exists to explain.
  it('rejects a body whose declared Content-Length exceeds the cap, before reading any of it', async () => {
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
            'content-length': MAX_BODY_BYTES + 1,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end('tiny body, deliberately far short of the declared length — see comment above');
    });
    expect(status).toBe(413);
  });

  // `fetch` always computes and sends a correct Content-Length for a fixed-size body, so it cannot
  // exercise this branch — the running-total backstop only matters when the header is absent or
  // lying. `node:http.request`, writing across multiple chunks instead of one `.end(buf)`, makes
  // Node omit Content-Length and fall back to chunked transfer encoding (verified independently:
  // the server sees `content-length: undefined` this way).
  //
  // The write pacing below is deliberately tuned, not arbitrary, because this test WILL send a
  // real ~1 MiB over the wire (unlike the Content-Length test above, there's no way to trip a
  // running total without genuinely reading that many bytes) — the exact failure mode
  // `respondTooLarge`'s comment describes. What's tuned to keep it out of that failure mode:
  //   - exactly `MAX_BODY_BYTES + 1` bytes are sent, not a chunk-boundary-rounded overshoot — the
  //     minimum overage possible, and a smaller flood is a smaller chance of leaving the kernel
  //     receive buffer non-empty at close time.
  //   - each write awaits 'drain' before the next, so the client never gets far ahead of what the
  //     server has actually read.
  //   - 8 KiB chunks, not 64 KiB — a first pass at 64 KiB, sent as part of the full 7-test file
  //     (not in isolation — that distinction mattered: an isolated repeated-loop version of the
  //     64 KiB mechanism ran clean 60+ times, but as test 5 of 7 in the real file it failed 2 times
  //     in 20 consecutive full-file runs with `ECONNRESET`, apparently from resource pressure left
  //     over by the preceding tests' servers/sockets that a clean single-purpose script doesn't
  //     have). Smaller chunks did NOT get chosen because 8 KiB is a magic number — they were the
  //     first size tried after 64 KiB that came back clean; the mechanism is what matters; the
  //     number is not sacred.
  // Don't "simplify" this back to a single `.end(bigBuffer)` write or a larger chunk size — both
  // were tried, both reset. Evidence: 20/20 clean full-file runs, twice (40/40 total) — see the
  // task report's Fix round 2 section, including the 64 KiB run that didn't clear the bar first.
  it('rejects an over-cap body sent without a Content-Length header', async () => {
    await boot();
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: handle!.port,
          path: '/mcp',
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: ACCEPT },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      (async () => {
        const chunkSize = 8 * 1024;
        const chunk = Buffer.alloc(chunkSize, 'a');
        const target = MAX_BODY_BYTES + 1;
        let sent = 0;
        while (sent < target) {
          const remaining = target - sent;
          const piece = remaining < chunkSize ? chunk.subarray(0, remaining) : chunk;
          const ok = req.write(piece);
          sent += piece.length;
          if (!ok) await new Promise<void>((r) => req.once('drain', r));
        }
        req.end();
      })();
    });
    expect(status).toBe(413);
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
