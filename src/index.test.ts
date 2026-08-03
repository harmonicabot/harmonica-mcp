/**
 * Tool-registration contract tests.
 *
 * These exist because of a real gap: the other suites exercise `client.ts` and `methodSpec.ts`
 * directly and nothing ever constructed a server, so tool *registration* — the surface the SDK v2
 * migration changed — had zero coverage. A renamed export, a malformed schema, or a tool silently
 * dropped from the list would all have shipped green.
 *
 * They drive the built binary over stdio rather than importing a factory, because what we publish
 * is the binary: this is the same request a client actually sends, and it catches bootstrap
 * failures (bad import specifier, transport wiring) that a unit test on a factory cannot.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

/** The 2026-07-28 envelope. Both fields are required — omitting either is a -32602. */
const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
};

function request(params: Record<string, unknown> | undefined): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY], {
      env: { ...process.env, HARMONICA_API_KEY: 'test-key-not-used-by-tools-list' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out; stdout=${out.slice(0, 200)} stderr=${err.slice(0, 200)}`));
    }, 20_000);

    child.stdout.on('data', (c) => {
      out += c;
    });
    child.stderr.on('data', (c) => {
      err += c;
    });
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.trim().split('\n')[0];
      if (!line) return reject(new Error(`no response; stderr=${err.slice(0, 300)}`));
      try {
        resolve(JSON.parse(line));
      } catch (e) {
        reject(new Error(`unparseable response: ${line.slice(0, 200)}`));
      }
    });

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params })}\n`);
    child.stdin.end();
  });
}

describe('tools/list over stdio', () => {
  beforeAll(() => {
    if (!existsSync(ENTRY)) {
      throw new Error(`${ENTRY} missing — run \`npm run build\` first (npm test does this for you)`);
    }
  });

  it('answers with no initialize handshake', async () => {
    // The point of the stateless core (SEP-2575/SEP-2567). On v1 this request was rejected
    // outright, so this asserts the migration actually happened rather than trusting the version.
    const res = await request(undefined);
    expect(res.error).toBeUndefined();
    expect(res.result.tools.length).toBeGreaterThan(0);
  });

  it('registers every tool exactly once', async () => {
    const { result } = await request(undefined);
    const names = result.tools.map((t: any) => t.name);
    expect(names).toHaveLength(21);
    expect(new Set(names).size).toBe(names.length);
    // Spot-check across the surface rather than pinning the whole list, which would make every
    // new tool a test edit. These four span sessions, chat, method specs and projects.
    expect(names).toEqual(
      expect.arrayContaining(['create_session', 'chat_message', 'install_method_spec', 'publish_sensemaking_topic']),
    );
  });

  it('exposes a well-formed JSON Schema for every tool', async () => {
    const { result } = await request(undefined);
    for (const t of result.tools) {
      expect(t.inputSchema, `${t.name} has no inputSchema`).toBeDefined();
      expect(t.inputSchema.type, `${t.name} inputSchema is not an object`).toBe('object');
      expect(t.inputSchema.$schema, `${t.name} is not draft 2020-12`).toBe(
        'https://json-schema.org/draft/2020-12/schema',
      );
    }
    // NOTE: this does NOT prove we avoided the deprecated raw-shape path. Verified by forcing a
    // raw shape through and re-running: the SDK's auto-wrap emits byte-identical JSON Schema,
    // $schema included, and all of these still passed. Deprecation is a compile-time distinction
    // with no runtime signal, so the guard for it is structural — see the test below.
  });

  it('emits the tools/list cache hint to 2026-07-28 clients', async () => {
    const { result } = await request({ _meta: MODERN_META });
    expect(result.ttlMs).toBe(60 * 60 * 1000);
    expect(result.cacheScope).toBe('public');
  });

  it('omits cache fields for legacy-era clients', async () => {
    // Not a nice-to-have: emitting 2026-07-28 result fields to a 2025-era client would be a
    // protocol violation. Proves the hint is era-gated rather than unconditionally attached.
    const { result } = await request(undefined);
    expect(result.ttlMs).toBeUndefined();
    expect(result.cacheScope).toBeUndefined();
  });

  it('keeps every tool off the deprecated raw-shape path', () => {
    // Structural, because it cannot be observed at runtime: raw-shape `inputSchema` is deprecated
    // but auto-wrapped to identical output, so only the source can tell you which overload is in
    // play. The guarantee is that there is exactly ONE registerTool call and it wraps — which is
    // also what stops a tool added later from quietly landing on the deprecated path.
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');
    const calls = src.match(/registerTool\(/g) ?? [];
    expect(calls, 'more than one registerTool call — the single wrapping boundary is gone').toHaveLength(1);
    expect(src).toMatch(/registerTool\(name, \{ description, inputSchema: z\.object\(shape\) \}/);
  });

  it('rejects a malformed 2026-07-28 envelope', async () => {
    // clientCapabilities is required alongside protocolVersion. Asserted because it is the exact
    // mistake made while smoke-testing this migration by hand.
    const res = await request({
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
    });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('clientCapabilities');
  });
});
