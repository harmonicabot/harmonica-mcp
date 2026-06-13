# `install_method_spec` MCP tool — design

**Date:** 2026-06-13
**Status:** approved (brainstorming output), ready for implementation plan
**Ticket:** HAR-1064 (method-spec format / runtime adapter — step 3)
**Repo:** `harmonica-mcp` (this repo)
**Depends on:** HAR-1098 (shipped) — `POST/PATCH /api/v1/templates` accept `template_type:'chain'` + `chain_config`.

## Goal

Let an agent install a forked OFL method spec as a runnable Harmonica chain
template, straight through the MCP — the "fork this method into your agent" flow.
The agent passes a `method.md` document; the tool maps it to a `chain_config` and
creates (or updates) a chain template via the v1 API. First real target: the
`many-to-many-readiness` spec (5 stages).

## Decisions locked (brainstorming)

1. **Home / surface:** an MCP tool `install_method_spec` in `harmonica-mcp`
   (chosen over a CLI in the method-specs repo). The MCP already wraps v1 and
   holds the API key, so the install runs with the caller's tier.
2. **Input:** inline content — a `method_md` string param. The agent reads the
   spec file locally (the registry is private) and passes the text. No fetch, no
   GitHub token. (By-URL / by-id input is deferred to the public/CC0 flip.)
3. **Operation scope:** install + dry-run + update.
4. **Transform location:** a pure module in `harmonica-mcp` (`src/methodSpec.ts`),
   unit-tested, wrapped by the tool — not inlined (untestable) and not a shared
   cross-repo lib (YAGNI until a second consumer exists).

## Architecture

Four changes in `harmonica-mcp`:

1. **`src/methodSpec.ts`** — pure, no I/O. Two functions + types:
   - `parseMethodSpec(md: string): MethodSpec` — split YAML frontmatter (via
     `js-yaml`) from the markdown body; extract each `## Stage: <id>` body
     section keyed by id.
   - `toChainConfig(spec: MethodSpec): TemplateInstall` — map to
     `{ title, description, template_type, chain_config }`.
   - Types: `MethodSpec`, `TemplateInstall`, `ChainConfig`, `ChainStep`.
2. **`src/client.ts`** — add `createTemplate(values)`, `updateTemplate(id, values)`,
   `listTemplates()`. Reuse the existing `request()` (Bearer + 429 retry + error
   unwrap). `getMe()` already exists (owner-matching for update).
3. **`src/index.ts`** — register the `install_method_spec` tool.
4. **Test infra** — add `vitest` devDep + `"test"` script (first tests in the
   repo) and `src/methodSpec.test.ts`.

Each unit has one responsibility and a clear interface: the transform knows
nothing about HTTP; the client knows nothing about the method-spec format; the
tool wires them and shapes the response.

## The transform (mapping contract)

Input `method.md` → output `{ title, description, template_type:'chain', chain_config }`.

**Top level**
- `title` ← frontmatter `title`.
- `description` ← frontmatter `summary` + the `attribution` line, so the CC BY-NC
  credit travels with the template.
- `template_type` ← `runtime.artifact`. **Reject** unless `artifact === 'chain'`
  and `runtime.reference === 'harmonica'`.
- `chain_config.output_artifact` ← only if frontmatter declares one (M2M omits it;
  only `wardley` is valid server-side).

**Per stage** (frontmatter `stages[]`, in order) → one `chain_config.steps[]`:

| chain_config step field | source |
|---|---|
| `id` | `stage.id` |
| `title` | `stage.title` |
| `context_mode` | `stage.context_mode` (enum already matches) |
| `assignment_strategy` | `stage.assignment_strategy` |
| `roles` | `stage.roles` (slugs) **expanded** to `{ slug, label }` via the top-level `roles[]` lookup |
| `completion_criteria` | `stage.completion` string → `{ type: <string> }`; if the author wrote an object, pass it through |
| `facilitation_prompt` | the body `## Stage: <id>` section (Goal + prose + Output), heading stripped, with a one-line lens reminder prepended (see below) |

**Resolved sub-decisions**
- `facilitation_prompt` = the **whole body section** (Goal + facilitation prose +
  Output), not prose-only — the facilitator gets the full intent.
- `lenses` ([value, power, risk, ownership]) → **prepended to each step's prompt**
  as one line ("Read every question through these lenses: …"). No `chain_config`
  field exists for lenses; the body already weaves them in, so this is
  reinforcement. If a spec omits `lenses`, the line is omitted.
- Spec fields with no machine home are dropped from `chain_config`:
  per-stage `output` (already present in the composed prompt as the Output line),
  `version`, `status`, `source_method`, `license`, `evals`. `attribution` rides in
  the template `description`.

**Validation** — lean local + server-authoritative:
- Local (pre-API, fail fast with a clear message): `runtime.artifact === 'chain'`;
  every stage role slug resolves to a defined top-level role; ≥ 1 stage; valid
  YAML + frontmatter present.
- Everything else defers to the server's `chainConfigSchema` (HAR-915) — the tool
  does **not** duplicate the schema. A 400 surfaces the server's message.

## Tool contract — `install_method_spec`

Params (zod):
- `method_md: string` (required) — full method.md content.
- `dry_run?: boolean` (default `false`) — build + return the `chain_config`, no write.
- `template_id?: string` — update this existing template (PATCH) instead of creating.
- `update_if_exists?: boolean` (default `false`) — if no `template_id`, find an
  owned chain template with the same title and PATCH it; else create.
- `is_public?: boolean` (**default `false`**) — M2M is draft / CC BY-NC; keep installs private.

**Resolution order**
1. `dry_run` → return the built `chain_config` (+ a note), no API call.
2. else if `template_id` → `PATCH /templates/{id}`.
3. else if `update_if_exists` → `listTemplates()` + `getMe()`, find an owned
   `template_type:'chain'` template with the same `title`; PATCH if found, else POST.
4. else → `POST /templates`.

**Return:** human-readable text — created/updated, template id, title, step count,
public/private — plus the echoed `chain_config` (HAR-1098 returns it on
create/update). dry-run returns the `chain_config` for the agent to eyeball.

## Error handling

All surfaced as tool **text** (not thrown), so the agent can react:
- Parse errors (missing/invalid frontmatter, no stages) — no API call.
- Unresolved role slug — names the offending stage + slug.
- Non-chain artifact — "install_method_spec only handles chain specs."
- Bubbled API errors from `client.request` (already formatted
  `Harmonica API error <status>: <msg>`): notably **403 over the step cap**
  (Free + M2M's 5 steps → upgrade message) and **400 invalid chain_config**.

## Testing

- **Unit (CI-able):** `vitest` + `src/methodSpec.test.ts`. Fixture = the M2M
  `method.md` (committed under `src/__fixtures__/` or read inline). Assert: parses
  5 stages in order; role slugs expand to `{slug,label}`; `completion: all_submitted`
  → `{type:'all_submitted'}`; `context_mode` preserved; invariants hold (≥1 step,
  unique step ids, unique role slugs per step); non-chain artifact rejected;
  unknown role slug rejected. The server remains the authoritative validator —
  tests assert structure, not a re-implemented schema.
- **Live smoke (manual, not CI):** with a **Pro/LTD** `HARMONICA_API_KEY`, run the
  tool on M2M, confirm a **private** chain template is created in prod, then
  delete or update it. (5 steps → needs a paid key; Free 403s at the cap.)

## Release

`harmonica-mcp` publishes to npm. Ship the tool with `npm version minor` +
`npm publish` (the McpServer version reads from `package.json`). Note in the
implementation plan as the final step.

## Out of scope (v1)

- By-URL / by-id spec input — revisit on the registry's public/CC0 flip.
- `single`-artifact specs — single templates already install via the existing
  API; this tool is chain-only.
- Emitting a derived `method.yaml` for non-Harmonica runtimes.
- Auto-managing the M2M `draft → tested` promotion.

## Caveats

- **Draft + licence:** M2M is `status: draft` and CC BY-NC (Dark Matter Labs).
  Keep installs **private**; do not make the template public until DML signs off
  (ties to the outreach thread). The transform carries the attribution into the
  template description regardless.
- Supersedes the earlier `docs/runtime-adapter-handoff.md` in the method-specs
  repo, which assumed a CLI in that repo. The home is now this MCP tool; that
  handoff should be updated to point here.
