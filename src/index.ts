#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

serveStdio(() => createServer(pkg.version), {
  onerror: (error) => {
    console.error('MCP transport error:', error);
  },
});
