import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseMethodSpec, toChainConfig } from './methodSpec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const M2M = readFileSync(join(__dirname, '__fixtures__', 'many-to-many-readiness.method.md'), 'utf-8');

const MINIMAL = `---
id: demo
title: Demo Method
runtime:
  reference: harmonica
  artifact: chain
roles:
  - { slug: a, label: Role A }
stages:
  - { id: one, title: Step One, roles: [a], assignment_strategy: all_participants, context_mode: none, completion: all_submitted, output: out1 }
---

Intro paragraph (not a stage).

## Stage: one
**Goal:** do the first thing.

Some facilitation prose.

**Output:** out1.
`;

describe('parseMethodSpec', () => {
  it('parses frontmatter fields', () => {
    const spec = parseMethodSpec(MINIMAL);
    expect(spec.frontmatter.id).toBe('demo');
    expect(spec.frontmatter.title).toBe('Demo Method');
    expect(spec.frontmatter.runtime?.artifact).toBe('chain');
    expect(spec.frontmatter.stages?.[0].id).toBe('one');
  });

  it('extracts stage body sections keyed by id, heading stripped', () => {
    const spec = parseMethodSpec(MINIMAL);
    expect(Object.keys(spec.stageBodies)).toEqual(['one']);
    expect(spec.stageBodies.one).toContain('**Goal:** do the first thing.');
    expect(spec.stageBodies.one).toContain('**Output:** out1.');
    expect(spec.stageBodies.one).not.toContain('## Stage: one');
    expect(spec.stageBodies.one).not.toContain('Intro paragraph');
  });

  it('throws when frontmatter is missing', () => {
    expect(() => parseMethodSpec('no frontmatter here')).toThrow(/frontmatter/i);
  });
});

const SPEC = `---
id: demo
title: Demo Method
summary: A demo.
attribution: "Adapted from X, CC BY-NC 4.0"
runtime:
  reference: harmonica
  artifact: chain
lenses: [value, power]
roles:
  - { slug: a, label: Role A }
  - { slug: b, label: Role B }
stages:
  - { id: one, title: Step One, roles: [a], assignment_strategy: all_participants, context_mode: none, completion: all_submitted, output: out1 }
  - { id: two, title: Step Two, roles: [a, b], assignment_strategy: all_participants, context_mode: previous_summary, completion: all_submitted, output: out2 }
---

## Stage: one
**Goal:** g1. prose1.

## Stage: two
**Goal:** g2. prose2.
`;

describe('toChainConfig', () => {
  it('maps stages to chain_config steps in order', () => {
    const out = toChainConfig(parseMethodSpec(SPEC));
    expect(out.template_type).toBe('chain');
    expect(out.title).toBe('Demo Method');
    expect(out.chain_config.steps.map((s) => s.id)).toEqual(['one', 'two']);
  });

  it('expands role slugs to {slug,label}', () => {
    const out = toChainConfig(parseMethodSpec(SPEC));
    expect(out.chain_config.steps[1].roles).toEqual([
      { slug: 'a', label: 'Role A' },
      { slug: 'b', label: 'Role B' },
    ]);
  });

  it('maps completion string to {type}', () => {
    const out = toChainConfig(parseMethodSpec(SPEC));
    expect(out.chain_config.steps[0].completion_criteria).toEqual({ type: 'all_submitted' });
  });

  it('prepends the lens line and includes the body in facilitation_prompt', () => {
    const out = toChainConfig(parseMethodSpec(SPEC));
    expect(out.chain_config.steps[0].facilitation_prompt).toMatch(/^Read every question through these lenses: value, power\./);
    expect(out.chain_config.steps[0].facilitation_prompt).toContain('prose1');
  });

  it('composes description from summary + attribution', () => {
    const out = toChainConfig(parseMethodSpec(SPEC));
    expect(out.description).toBe('A demo.\n\nAdapted from X, CC BY-NC 4.0');
  });

  it('rejects a non-chain artifact', () => {
    const single = SPEC.replace('artifact: chain', 'artifact: single');
    expect(() => toChainConfig(parseMethodSpec(single))).toThrow(/only handles chain specs/i);
  });

  it('rejects an unknown role slug', () => {
    const bad = SPEC.replace('roles: [a, b]', 'roles: [a, zzz]');
    expect(() => toChainConfig(parseMethodSpec(bad))).toThrow(/zzz/);
  });

  it('passes an object-form completion through unchanged', () => {
    const timer = SPEC.replace(
      'completion: all_submitted, output: out1',
      'completion: { type: timer, duration_seconds: 300 }, output: out1',
    );
    const out = toChainConfig(parseMethodSpec(timer));
    expect(out.chain_config.steps[0].completion_criteria).toEqual({ type: 'timer', duration_seconds: 300 });
  });
});

describe('parseMethodSpec — robustness', () => {
  it('handles CRLF line endings', () => {
    const crlf = MINIMAL.replace(/\n/g, '\r\n');
    const spec = parseMethodSpec(crlf);
    expect(spec.frontmatter.id).toBe('demo');
    expect(Object.keys(spec.stageBodies)).toEqual(['one']);
  });

  it('throws a clean error on empty frontmatter', () => {
    // Valid fence structure but an empty YAML body → yaml.load returns undefined.
    expect(() => parseMethodSpec('---\n\n---\n')).toThrow(/empty or not a YAML object/i);
  });
});

describe('many-to-many-readiness (real spec)', () => {
  it('produces a 5-step chain in stage order', () => {
    const out = toChainConfig(parseMethodSpec(M2M));
    expect(out.chain_config.steps.map((s) => s.id)).toEqual([
      'context-diagnostic',
      'asset-mapping',
      'role-mapping',
      'risk-mapping',
      'readiness-synthesis',
    ]);
  });

  it('expands roles and keeps invariants (unique ids, unique slugs/step)', () => {
    const out = toChainConfig(parseMethodSpec(M2M));
    const ids = out.chain_config.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const step of out.chain_config.steps) {
      const slugs = (step.roles ?? []).map((r) => r.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const r of step.roles ?? []) expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it('maps every stage completion to all_submitted', () => {
    const out = toChainConfig(parseMethodSpec(M2M));
    for (const step of out.chain_config.steps) {
      expect(step.completion_criteria).toEqual({ type: 'all_submitted' });
    }
  });

  it('carries attribution into the description', () => {
    const out = toChainConfig(parseMethodSpec(M2M));
    expect(out.description).toContain('Dark Matter Labs');
  });
});
