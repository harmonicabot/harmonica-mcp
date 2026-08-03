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
  return new Request(url, { method: req.method, headers, body: hasBody ? new Uint8Array(body) : undefined });
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
