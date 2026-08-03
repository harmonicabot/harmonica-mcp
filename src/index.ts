#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './tools.js';
import { HarmonicaClient } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const HARMONICA_API_URL = process.env.HARMONICA_API_URL || 'https://app.harmonica.chat';
const HARMONICA_API_KEY = process.env.HARMONICA_API_KEY;

/** stdio stays the default, so every existing `npx -y harmonica-mcp` install is unaffected. */
const useHttp = process.env.MCP_TRANSPORT === 'http' || process.argv.includes('--http');

function die(...lines: string[]): never {
  for (const line of lines) console.error(line);
  process.exit(1);
}

if (useHttp) {
  // Both guards below refuse to start rather than carrying on with a usable-looking server. That
  // is the point: each misconfiguration is silent at runtime — nothing downstream looks wrong, no
  // request fails, no log line is alarming — so startup is the only place the mistake is still
  // cheap. A server that boots is a server someone points traffic at.

  if (HARMONICA_API_KEY) {
    // In HTTP mode every caller supplies its own key per request. A server-side key would be used
    // for all of them, so an anonymous caller would act as whoever owns this deploy's account —
    // reading their sessions, creating sessions billed to them. The likely way to arrive here is
    // copying a working stdio config as a starting point, which is exactly why this refuses
    // rather than quietly ignoring the variable.
    die(
      'Error: HARMONICA_API_KEY must NOT be set when MCP_TRANSPORT=http.',
      'In HTTP mode each caller supplies its own key via `Authorization: Bearer <key>`.',
      'A server-side key would make every caller act as that one account. Unset it.',
    );
  }

  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  if (allowedHosts.length === 0) {
    // The SDK exposes no `allowedHosts` option and performs no host validation of its own, so an
    // unset allowlist is not a permissive default — it is no DNS-rebinding protection at all.
    die(
      'Error: MCP_ALLOWED_HOSTS is required when MCP_TRANSPORT=http.',
      'Comma-separated hostnames this server answers for, e.g. mcp.example.com',
      'Without it there is no DNS-rebinding protection.',
    );
  }

  // Imported lazily so a stdio run never loads the HTTP server or pays for `node:http`.
  const { startHttpServer } = await import('./http.js');
  const handle = await startHttpServer({
    port: Number(process.env.PORT ?? 3000),
    allowedHosts,
    apiBaseUrl: HARMONICA_API_URL,
    version: pkg.version,
  });
  // stderr, not stdout: stdout is the protocol channel in the sibling transport, so keeping every
  // log line on stderr means log handling does not depend on which mode is running.
  console.error(
    `harmonica-mcp ${pkg.version} listening on :${handle.port} (hosts: ${allowedHosts.join(', ')})`,
  );
} else {
  if (!HARMONICA_API_KEY) {
    die(
      'Error: HARMONICA_API_KEY environment variable is required.',
      'Generate one at https://app.harmonica.chat (Profile → API Keys)',
    );
  }

  const client = new HarmonicaClient({
    baseUrl: HARMONICA_API_URL,
    apiKey: HARMONICA_API_KEY,
  });

  serveStdio(() => createServer(client, pkg.version), {
    onerror: (error) => {
      console.error('MCP transport error:', error);
    },
  });
}
