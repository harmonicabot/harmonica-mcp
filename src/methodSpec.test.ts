import { describe, it, expect } from 'vitest';
import { parseMethodSpec } from './methodSpec.js';

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
