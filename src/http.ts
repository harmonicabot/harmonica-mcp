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

/**
 * Hard cap on inbound request body size, enforced before the routing or auth decision — an
 * anonymous caller can POST an oversized body to ANY path, including 404s and /healthz. JSON-RPC
 * tool calls are kilobytes; this is a resource guard against unbounded memory growth on a
 * published, self-hostable, internet-facing server, not a rate limiter.
 */
export const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

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
  return new Request(url, { method: req.method, headers, body: hasBody ? new Uint8Array(body) : undefined });
}

async function writeWebResponse(res: ServerResponse, web: Response, req: IncomingMessage): Promise<void> {
  res.statusCode = web.status;
  web.headers.forEach((value, name) => res.setHeader(name, value));
  if (!web.body) {
    res.end();
    return;
  }
  const reader = web.body.getReader();
  // An abandoned client (the request socket closes mid-response) must not leave the upstream
  // stream running forever. Nothing streams today, which is exactly why this is worth having
  // before the first tool that does makes it a real leak instead of a theoretical one.
  const cancelOnClose = () => {
    void reader.cancel();
  };
  req.once('close', cancelOnClose);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    req.off('close', cancelOnClose);
  }
  res.end();
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

async function respondTooLarge(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Discard whatever the client is still sending rather than destroying the socket outright.
  // Verified empirically (both `fetch` and `node:http.request`, a truthful oversized
  // Content-Length): destroying the socket right after `res.end()` reliably produced a
  // client-visible ECONNRESET instead of the 413 — a socket destroyed while a large amount of the
  // peer's data is still unread in the kernel receive buffer sends an abortive RST instead of a
  // graceful close, and that RST can beat (or wipe) the response we just wrote. `req.resume()`
  // discards without buffering, so the memory bound this whole guard exists for still holds — the
  // client can keep pushing bytes, but they land nowhere and cost nothing but the CPU to discard.
  // `Connection: close` tells Node to close the socket once the response (and any remaining drain)
  // finishes, which is what actually stops this connection from being reused, deterministically
  // rather than via a destroy() that raced the response delivery.
  req.resume();
  res.setHeader('connection', 'close');
  await writeWebResponse(res, json(413, { error: `body exceeds the ${MAX_BODY_BYTES}-byte limit` }), req);
}

/**
 * Reads the request body under `MAX_BODY_BYTES`, responding 413 and tearing down the connection
 * if it's exceeded. Runs before any routing or auth decision, so it guards every path — including
 * /healthz and unknown ones — not just /mcp.
 *
 * Two independent checks, because `Content-Length` is caller-supplied and cannot be trusted alone:
 * a truthful one lets us reject before reading a single byte of an oversized body; a running total
 * catches the header being absent or simply wrong.
 */
async function readBody(req: IncomingMessage, res: ServerResponse): Promise<Buffer | undefined> {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    await respondTooLarge(req, res);
    return undefined;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      await respondTooLarge(req, res);
      return undefined;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

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
        const body = await readBody(req, res);
        if (body === undefined) return; // 413 already sent, connection already torn down

        const webReq = toWebRequest(req, body);
        const { pathname } = new URL(webReq.url);

        if (pathname === '/healthz') {
          // No auth and no upstream call: an outage at the Harmonica API must not make the
          // platform think this process is dead.
          await writeWebResponse(res, json(200, { status: 'ok', version: opts.version }), req);
          return;
        }
        if (pathname !== '/mcp') {
          await writeWebResponse(res, json(404, { error: 'not found' }), req);
          return;
        }

        const hostRejection = hostHeaderValidationResponse(webReq, opts.allowedHosts);
        if (hostRejection) {
          await writeWebResponse(res, hostRejection, req);
          return;
        }

        if (!bearerFrom(webReq)) {
          await writeWebResponse(
            res,
            new Response(JSON.stringify({ error: 'missing or malformed Authorization: Bearer <harmonica-api-key>' }), {
              status: 401,
              headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
            }),
            req,
          );
          return;
        }

        await writeWebResponse(res, await handler.fetch(webReq), req);
      } catch (error) {
        console.error('request failed:', error);
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      }
    })();
  });

  const port = await new Promise<number>((resolve, reject) => {
    const onStartupError = (error: Error) => reject(error);
    server.once('error', onStartupError);
    server.listen(opts.port, () => {
      // This startup listener exists only to surface a bind failure (e.g. EADDRINUSE) as a
      // rejected promise. Left attached, `once` still auto-removes it on the FIRST post-startup
      // error (an EMFILE under load, say) as a harmless no-op reject against an already-settled
      // promise — but from then the server has NO error listener at all, and the next one throws
      // synchronously and takes the process down along with every in-flight connection. Remove it
      // explicitly the moment startup succeeds, before that can happen.
      server.removeListener('error', onStartupError);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : opts.port);
    });
  });

  // Permanent replacement for the startup-only listener above: logs and keeps the process alive
  // for whatever comes after startup, instead of leaving the server with zero error listeners.
  server.on('error', (error) => {
    console.error('HTTP server error:', error);
  });

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        // Under Node's default unhandled-rejection behaviour, a rejection here with no handler
        // crashes the process during teardown.
        handler.close().catch((error) => console.error('MCP handler close error:', error));
        server.close(() => resolve());
      }),
  };
}
