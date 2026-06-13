# install_method_spec MCP Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `install_method_spec` MCP tool to harmonica-mcp that turns an OFL method spec (`method.md`) into a runnable Harmonica chain template via the v1 API.

**Architecture:** A pure transform module (`src/methodSpec.ts`) parses YAML frontmatter + `## Stage:` body sections and maps them to a Harmonica `chain_config`. New `HarmonicaClient` methods (`createTemplate`/`updateTemplate`/`listTemplates`) call the v1 endpoints (HAR-1098). The tool in `src/index.ts` wires them with dry-run / install / update behaviour. The transform is unit-tested with vitest (first tests in the repo); the server's `chainConfigSchema` (HAR-915) remains the authoritative validator.

**Tech Stack:** TypeScript (ESM), `@modelcontextprotocol/sdk`, `zod` (existing), `js-yaml` (new dep), `vitest` (new devDep).

**Design:** `docs/plans/2026-06-13-install-method-spec-tool-design.md`

**Before starting:** create a feature branch and work in a worktree off `origin/master` (`git worktree add -b feat/install-method-spec .worktrees/install-method-spec origin/master`); junction `node_modules` from the main checkout if you need to run tests/build in the worktree, and tear the worktree down right after the final push (see `claude-config/memory/reference_agent_worktree_isolation_cwd`). Commit after each task. Open a PR at the end.

---

## File Structure

- **Create `src/methodSpec.ts`** — pure transform: types + `parseMethodSpec()` + `toChainConfig()`. No I/O. The risky logic; fully unit-tested.
- **Create `src/methodSpec.test.ts`** — vitest unit tests for parse + transform.
- **Create `src/__fixtures__/many-to-many-readiness.method.md`** — frozen copy of the M2M spec, used by the integration test.
- **Create `src/client.test.ts`** — one fetch-mocked test for `createTemplate`.
- **Create `vitest.config.ts`** — minimal vitest config.
- **Modify `src/client.ts`** — add `ApiTemplate` type + `createTemplate`/`updateTemplate`/`listTemplates`.
- **Modify `src/index.ts`** — register the `install_method_spec` tool.
- **Modify `package.json`** — add `js-yaml` dep, `@types/js-yaml` + `vitest` devDeps, `"test": "vitest run"` script.

---

## Task 1: Dependencies + test harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/smoke.test.ts` (temporary — deleted in step 5)

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install js-yaml
npm install -D @types/js-yaml vitest
```
Expected: `package.json` gains `js-yaml` under `dependencies` and `@types/js-yaml`, `vitest` under `devDependencies`.

- [ ] **Step 2: Add the test script**

Modify `package.json` `"scripts"` — add:
```json
"test": "vitest run"
```

- [ ] **Step 3: Add vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Write a smoke test to prove the harness runs**

Create `src/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('vitest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it, confirm green, then delete the smoke test**

Run: `npm test`
Expected: 1 passed.
Then: `rm src/smoke.test.ts`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add js-yaml + vitest test harness"
```

---

## Task 2: `parseMethodSpec` — frontmatter + stage bodies

**Files:**
- Create: `src/methodSpec.ts`
- Create: `src/methodSpec.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/methodSpec.test.ts`:
```ts
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
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './methodSpec.js'`.

- [ ] **Step 3: Implement types + `parseMethodSpec`**

Create `src/methodSpec.ts`:
```ts
import yaml from 'js-yaml';

export interface MethodSpecRole {
  slug: string;
  label: string;
  weight?: 'normal' | 'elevated' | 'lead';
}

export interface MethodSpecStage {
  id: string;
  title?: string;
  roles?: string[];
  assignment_strategy?: string;
  context_mode?: string;
  completion?: string | { type: string; [k: string]: unknown };
  output?: string;
}

export interface MethodSpecFrontmatter {
  id: string;
  title: string;
  version?: string;
  status?: string;
  summary?: string;
  source_method?: string;
  license?: string;
  attribution?: string;
  runtime?: { reference?: string; artifact?: string };
  lenses?: string[];
  roles?: MethodSpecRole[];
  stages?: MethodSpecStage[];
  output_artifact?: string;
  evals?: string;
}

export interface MethodSpec {
  frontmatter: MethodSpecFrontmatter;
  body: string;
  stageBodies: Record<string, string>;
}

function extractStageBodies(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /^##\s+Stage:\s*(\S+)\s*$/gm;
  const matches = [...body.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : body.length;
    result[id] = body.slice(start, end).trim();
  }
  return result;
}

export function parseMethodSpec(md: string): MethodSpec {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error('method.md is missing YAML frontmatter (--- … ---).');
  }
  let frontmatter: MethodSpecFrontmatter;
  try {
    frontmatter = yaml.load(fmMatch[1]) as MethodSpecFrontmatter;
  } catch (e) {
    throw new Error(`Invalid YAML frontmatter: ${(e as Error).message}`);
  }
  const body = fmMatch[2];
  return { frontmatter, body, stageBodies: extractStageBodies(body) };
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npm test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/methodSpec.ts src/methodSpec.test.ts
git commit -m "feat: parseMethodSpec — frontmatter + stage body extraction"
```

---

## Task 3: `toChainConfig` — the mapping

**Files:**
- Modify: `src/methodSpec.ts`
- Modify: `src/methodSpec.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/methodSpec.test.ts`:
```ts
import { toChainConfig } from './methodSpec.js';

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
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test`
Expected: FAIL — `toChainConfig is not exported`.

- [ ] **Step 3: Implement `toChainConfig` + types**

Append to `src/methodSpec.ts`:
```ts
export interface ChainStep {
  id: string;
  title?: string;
  facilitation_prompt?: string;
  context_mode?: string;
  roles?: MethodSpecRole[];
  assignment_strategy?: string;
  completion_criteria?: { type: string; [k: string]: unknown };
}

export interface ChainConfig {
  steps: ChainStep[];
  output_artifact?: string;
}

export interface TemplateInstall {
  title: string;
  description: string | null;
  template_type: 'chain';
  chain_config: ChainConfig;
}

export function toChainConfig(spec: MethodSpec): TemplateInstall {
  const { frontmatter: fm, stageBodies } = spec;

  if (fm.runtime?.artifact !== 'chain') {
    throw new Error(
      `install_method_spec only handles chain specs (runtime.artifact must be 'chain', got '${fm.runtime?.artifact ?? 'undefined'}').`,
    );
  }
  if (fm.runtime?.reference && fm.runtime.reference !== 'harmonica') {
    throw new Error(`Unsupported runtime.reference '${fm.runtime.reference}' (expected 'harmonica').`);
  }
  const stages = fm.stages ?? [];
  if (stages.length < 1) {
    throw new Error('Spec has no stages.');
  }

  const roleBySlug = new Map((fm.roles ?? []).map((r) => [r.slug, r]));
  const lensLine =
    fm.lenses && fm.lenses.length
      ? `Read every question through these lenses: ${fm.lenses.join(', ')}.\n\n`
      : '';

  const steps: ChainStep[] = stages.map((stage) => {
    const roles = (stage.roles ?? []).map((slug) => {
      const role = roleBySlug.get(slug);
      if (!role) {
        throw new Error(`Stage '${stage.id}' references role slug '${slug}' not defined in roles[].`);
      }
      return { slug: role.slug, label: role.label, ...(role.weight ? { weight: role.weight } : {}) };
    });

    let completion_criteria: { type: string; [k: string]: unknown } | undefined;
    if (typeof stage.completion === 'string') {
      completion_criteria = { type: stage.completion };
    } else if (stage.completion && typeof stage.completion === 'object') {
      completion_criteria = stage.completion;
    }

    const sectionBody = stageBodies[stage.id];
    if (!sectionBody) {
      throw new Error(`No "## Stage: ${stage.id}" section found in the method body.`);
    }

    return {
      id: stage.id,
      ...(stage.title ? { title: stage.title } : {}),
      facilitation_prompt: lensLine + sectionBody,
      ...(stage.context_mode ? { context_mode: stage.context_mode } : {}),
      ...(roles.length ? { roles } : {}),
      ...(stage.assignment_strategy ? { assignment_strategy: stage.assignment_strategy } : {}),
      ...(completion_criteria ? { completion_criteria } : {}),
    };
  });

  const chain_config: ChainConfig = {
    steps,
    ...(fm.output_artifact ? { output_artifact: fm.output_artifact } : {}),
  };

  const description = [fm.summary, fm.attribution].filter(Boolean).join('\n\n') || null;

  return { title: fm.title, description, template_type: 'chain', chain_config };
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npm test`
Expected: PASS (all parse + transform tests).

- [ ] **Step 5: Commit**

```bash
git add src/methodSpec.ts src/methodSpec.test.ts
git commit -m "feat: toChainConfig — method spec to Harmonica chain_config"
```

---

## Task 4: Integration test against the real M2M spec

**Files:**
- Create: `src/__fixtures__/many-to-many-readiness.method.md`
- Modify: `src/methodSpec.test.ts`

- [ ] **Step 1: Add the fixture**

Create `src/__fixtures__/many-to-many-readiness.method.md` as an exact copy of the current `methods/many-to-many-readiness/method.md` from the `Open-Facilitation-Library/method-specs` repo (frontmatter with 5 stages + the `## Stage:` body sections). This is a frozen snapshot for stable tests — do not edit it to track spec changes; refresh deliberately if the test needs to.

- [ ] **Step 2: Write the integration test**

Append to `src/methodSpec.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const M2M = readFileSync(join(__dirname, '__fixtures__', 'many-to-many-readiness.method.md'), 'utf-8');

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
```

- [ ] **Step 3: Run, verify it passes**

Run: `npm test`
Expected: PASS. If a `## Stage:` section is missing, the error names the stage id — fix the fixture to match the frontmatter stage ids.

- [ ] **Step 4: Commit**

```bash
git add src/__fixtures__/many-to-many-readiness.method.md src/methodSpec.test.ts
git commit -m "test: integration coverage against the real M2M spec"
```

---

## Task 5: Client methods

**Files:**
- Modify: `src/client.ts`
- Create: `src/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { HarmonicaClient } from './client.js';

afterEach(() => vi.restoreAllMocks());

describe('HarmonicaClient.createTemplate', () => {
  it('POSTs to /api/v1/templates with the chain body + bearer auth', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 't-1', title: 'X', template_type: 'chain' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new HarmonicaClient({ baseUrl: 'https://app.harmonica.chat', apiKey: 'hm_live_test' });
    const res = await client.createTemplate({ title: 'X', template_type: 'chain', chain_config: { steps: [{ id: 's1' }] } });

    expect(res.id).toBe('t-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://app.harmonica.chat/api/v1/templates');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer hm_live_test');
    expect(JSON.parse(init?.body as string).template_type).toBe('chain');
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test`
Expected: FAIL — `client.createTemplate is not a function`.

- [ ] **Step 3: Add the client methods**

In `src/client.ts`, add this interface above the `HarmonicaClient` class:
```ts
export interface ApiTemplate {
  id: string;
  title: string;
  description: string | null;
  template_type: string;
  chain_config: unknown | null;
  is_public: boolean;
  created_by: string | null;
  workspace_id: string | null;
  created_at: string;
  updated_at: string;
}
```

Add these methods inside the `HarmonicaClient` class (after `generateSummary`):
```ts
  async createTemplate(values: {
    title: string;
    description?: string | null;
    template_type?: 'single' | 'chain';
    chain_config?: unknown;
    is_public?: boolean;
  }) {
    return this.request<ApiTemplate>('/templates', {
      method: 'POST',
      body: JSON.stringify(values),
    });
  }

  async updateTemplate(id: string, values: {
    title?: string;
    description?: string | null;
    template_type?: 'single' | 'chain';
    chain_config?: unknown;
    is_public?: boolean;
  }) {
    return this.request<ApiTemplate>(`/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  }

  async listTemplates() {
    return this.request<{ data: ApiTemplate[] }>('/templates');
  }
```

- [ ] **Step 4: Run, verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts src/client.test.ts
git commit -m "feat: client createTemplate/updateTemplate/listTemplates (HAR-1098)"
```

---

## Task 6: The `install_method_spec` tool

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add the import**

At the top of `src/index.ts`, after the existing `import { HarmonicaClient } from './client.js';` line, add:
```ts
import { parseMethodSpec, toChainConfig } from './methodSpec.js';
```

- [ ] **Step 2: Register the tool**

In `src/index.ts`, add this `server.tool(...)` block immediately before the `// ─── Start ───` comment:
```ts
server.tool(
  'install_method_spec',
  'Install an OFL method spec (the contents of a method.md file) as a runnable Harmonica chain template. Pass the full method.md text as method_md. Use dry_run to preview the generated chain_config without writing anything. Chain templates need a paid (Pro/LTD) account; Free is capped at 3 steps.',
  {
    method_md: z.string().describe('Full contents of the method.md spec file (YAML frontmatter + body).'),
    dry_run: z.boolean().optional().describe('If true, return the generated chain_config without creating a template. Default false.'),
    template_id: z.string().optional().describe('Update this existing template (PATCH) instead of creating a new one.'),
    update_if_exists: z.boolean().optional().describe('If no template_id, update an owned chain template with the same title instead of creating a duplicate. Default false.'),
    is_public: z.boolean().optional().describe('Make the installed template public. Default false — drafts and CC-licensed specs should stay private.'),
  },
  async ({ method_md, dry_run, template_id, update_if_exists, is_public }) => {
    let install;
    try {
      install = toChainConfig(parseMethodSpec(method_md));
    } catch (e) {
      return { content: [{ type: 'text', text: `Could not parse method spec: ${(e as Error).message}` }] };
    }

    const stepCount = install.chain_config.steps.length;

    if (dry_run) {
      return {
        content: [{
          type: 'text',
          text: `Dry run — "${install.title}" (${stepCount} steps). No template created.\n\nchain_config:\n${JSON.stringify(install.chain_config, null, 2)}`,
        }],
      };
    }

    const values = {
      title: install.title,
      description: install.description,
      template_type: install.template_type,
      chain_config: install.chain_config,
      is_public: is_public ?? false,
    };

    try {
      let result;
      let action: 'Created' | 'Updated';

      if (template_id) {
        result = await client.updateTemplate(template_id, values);
        action = 'Updated';
      } else if (update_if_exists) {
        const me = await client.getMe();
        const existing = (await client.listTemplates()).data.find(
          (t) => t.template_type === 'chain' && t.title === install.title && t.created_by === me.id,
        );
        if (existing) {
          result = await client.updateTemplate(existing.id, values);
          action = 'Updated';
        } else {
          result = await client.createTemplate(values);
          action = 'Created';
        }
      } else {
        result = await client.createTemplate(values);
        action = 'Created';
      }

      const text = [
        `${action} chain template "${result.title}"`,
        `  Template ID: ${result.id}`,
        `  Steps:       ${stepCount}`,
        `  Visibility:  ${result.is_public ? 'public' : 'private'}`,
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Install failed: ${(e as Error).message}` }] };
    }
  },
);
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: clean compile, no TypeScript errors. (`dist/` regenerates.)

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: install_method_spec MCP tool"
```

---

## Task 7: Full verify + live smoke + release

**Files:** none (verification + release)

- [ ] **Step 1: Full test + build**

Run: `npm test && npm run build`
Expected: all tests pass; clean build.

- [ ] **Step 2: Live smoke (manual — needs a Pro/LTD key)**

Configure the locally-built MCP in an MCP client (e.g. Claude Code) with a **Pro/LTD** `HARMONICA_API_KEY` and `HARMONICA_API_URL=https://app.harmonica.chat`, pointing at this checkout's `dist/index.js`. Then:
1. Call `install_method_spec` with the M2M `method.md` content and `dry_run: true` — confirm the printed `chain_config` has 5 steps with expanded roles + `{type:'all_submitted'}`.
2. Call again with `dry_run: false` (default `is_public:false`) — confirm it returns a template ID and "Created … private".
3. In app.harmonica.chat, confirm the chain template exists and is private.
4. Re-run with `update_if_exists: true` — confirm it reports "Updated" (same template, no duplicate).
5. Clean up: delete the test template (or keep it private if you want it around). Do **not** make it public — M2M is draft + CC BY-NC pending DML sign-off.

If step 1 of a Free account is used by mistake, the install returns a 403 over the 3-step cap — that's expected; use a paid key.

- [ ] **Step 3: Update the tool table in CLAUDE.md + README**

Add an `install_method_spec` row to the MCP Tools table in `CLAUDE.md` and the tools list in `README.md` (one line each: "Install an OFL method spec as a chain template").

- [ ] **Step 4: Commit docs**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document install_method_spec tool"
```

- [ ] **Step 5: Open the PR**

Push the branch and open a PR against `master` summarising the tool + linking the design doc and HAR-1064. (harmonica-mcp has no CI; the local `npm test` + `npm run build` are the gate.)

- [ ] **Step 6: Release (requires npm auth — the maintainer runs this)**

After merge, from `master`:
```bash
npm version minor
npm publish
```
`prepublishOnly` runs the build. The McpServer version reads from `package.json`. Tear down the worktree (CWD out → delete → prune) once the branch is pushed.

---

## Notes

- **Server is the validator.** The transform does lean local checks (chain artifact, role-slug resolution, ≥1 stage); the server's `chainConfigSchema` (HAR-915) is authoritative and returns a 400 with a specific message on anything else. Don't duplicate the schema in the tool.
- **Draft + licence.** Keep installs private; the attribution rides in the template description automatically.
- **Out of scope (v1):** by-URL/by-id input, `single`-artifact specs, emitting `method.yaml` for non-Harmonica runtimes.
