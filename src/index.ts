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

if (!HARMONICA_API_KEY) {
  console.error('Error: HARMONICA_API_KEY environment variable is required.');
  console.error('Generate one at https://app.harmonica.chat (Profile → API Keys)');
  process.exit(1);
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
