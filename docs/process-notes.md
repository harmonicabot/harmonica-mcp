# Process Notes

Append-only per-session log. Format: `## YYYY-MM-DD — [topic]` + Done / Decisions / State / Next (4-6 lines).

## 2026-05-30 — Broaden create_session.questions + complete update_session parity (0.7.1)
- **Done:** `create_session.questions[]` now optionally accepts `type` ('Short field' | 'Email' | 'Options'), `required`, and `options` (PR #2). `update_session` brought to full v1 PATCH `ALLOWED_UPDATE_FIELDS` parity: added `widgets_enabled`, `results_visibility`, `questions` (PR #2) + `prompt_summary`, `prompt_generated_from`, `welcome_message`, `meta_description`, `intro_video_url`, `template_id`, `platform_guidelines_override` (follow-up commit `f90729d`). `client.ts` type mirrors all of the above. Published as `harmonica-mcp@0.7.1` to npm. Pro PR #342 is the matching API-side fix.
- **Decisions:** `prompt_summary` and `prompt_generated_from` docstrings warn that manual edits can confuse Brief-drift detection; `template_id` docstring warns of prompt-template desync without a recompose call. Bumped `0.7.0 → 0.7.1` rather than rewriting the 0.7.0 tag (cleaner history; 0.7.0 was never published to npm).
- **State:** master clean, 0.7.1 live on npm. 8 pre-existing TS strict-mode warnings turned out to be stale `node_modules` (missing `@types/node` despite being in package.json) — fixed by `npm install`, no code change.
- **Next:** None tracked. Open improvements (low priority): MCP `update_session` could also expose the few less-obvious PATCH fields if they ever come up.

## 2026-06-14 — install_method_spec tool (0.8.0)
- **Done:** Added `install_method_spec` (HAR-1064): `src/methodSpec.ts` (pure `parseMethodSpec` + `toChainConfig`), client `createTemplate`/`updateTemplate`/`listTemplates`, the tool in `index.ts`. Added a vitest harness (first tests in the repo; 18 passing incl. the real M2M spec fixture). Built subagent-driven from `docs/plans/2026-06-13-install-method-spec-tool-plan.md`. Merged #3, published `0.8.0`, live-installed Many-to-Many as a private chain template in prod with a PRO key.
- **Decisions:** Server-authoritative validation — lean local checks only (chain artifact, role-slug resolution, ≥1 stage); `chainConfigSchema` is the source of truth. Rejected the review's "mirror the Zod enums/unions in TS types" because those types sit on `yaml.load` output (a cast = no runtime guard) and would reintroduce schema drift. `tsconfig` excludes tests + fixtures from the published build.
- **State:** master clean + pushed; `0.8.0` live on npm; `v0.8.0` tagged.
- **Next:** none on the tool. M2M template kept private (spec is `draft` + CC BY-NC — loop Dark Matter Labs in before any public use).

## 2026-06-14 — provenance stamping in install_method_spec (0.9.0)
- **Done:** `install_method_spec` now sends `source_provenance` (spec_id/version from frontmatter) + a `registry` param + a `force` flag; `client.ts` `createTemplate`/`updateTemplate` types extended; new client test. Published `0.9.0`. End-to-end verified in prod (0.9.0 install path → deployed Pro stamped the full provenance blob; throwaway template cleaned up). HAR-1108 (Pro #410 ships the API side).
- **Decisions:** Server stamps `install_hash` + timestamps; the tool sends only spec identity (server-authoritative, same as 0.8.0).
- **State:** master clean; `0.9.0` live on npm; package-lock version synced to 0.9.0 in a follow-up.
- **Next:** none. Pairs with Pro #410 + harmonica-docs OpenAPI mirror.
- **Lesson:** Bump versions with `npm version` (updates package.json + package-lock together), not a hand-edit — Task 10's hand-edit left a version mismatch on master, fixed in a follow-up commit.

## 2026-06-25 — create_project + publish_sensemaking_topic tools (0.10.0)
- **Done:** Added `create_project` + `publish_sensemaking_topic` tools + client methods (`createProject`, `publishSensemakingTopic`, `getSensemakingTopic`) wrapping the new Pro v1 endpoints (harmonica-web-app-pro#488, HAR-1119). Tests 21/21. Merged #5, published 0.10.0 (npm latest). harmonica-docs OpenAPI + docs.json nav + mcp-server.mdx updated.
- **Decisions:** snake_case tool params mapped to the v1 camelCase toggles (`reasoningLensEnabled`/`knowledgeStatementsEnabled`); `getSensemakingTopic` client-only (no tool); mirrored the `createTemplate`/`install_method_spec` shape.
- **State:** master clean; 0.10.0 live on npm.
- **Next:** none on the tools. HAR-1119 has an optional live mutating end-to-end smoke.
- **Lesson (again):** hand-edited the version in PR #5 → package-lock drifted 0.9.0→0.10.0 (same trap as the 0.9.0 entry). Re-synced this wrap-up via `npm version 0.10.0 --allow-same-version --no-git-tag-version`. Use `npm version` next time.

## 2026-05-23 — list_templates tool (0.11.0)
- **Done:** Added `list_templates` tool (HAR-1227 Phase 2) wrapping the existing `client.listTemplates()` → `GET /api/v1/templates`. Returns `id / title / description / template_type` for each template visible to the caller. Inserted right before `chat_message` in the tool ordering. Tests 21/21. Bumped via `npm version minor` (no hand-edit this time — heeded the lesson from 0.10.0). Published 0.11.0 to npm (latest). Tag v0.11.0 pushed.
- **Decisions:** Tool returns text-formatted list (markdown bullets) following the `list_telegram_groups` pattern, not JSON — consumers parse it the same way. Included `template_type` (single|chain) for context but kept payload minimal. Did NOT filter to public-only here; the v1 endpoint already does the "visible to caller" filtering (HAR-564), so the MCP tool just relays.
- **State:** master clean + pushed @ f6c8e23; 0.11.0 live on npm; v0.11.0 tag pushed.
- **Next:** None on this tool. Unlocks harmonica-chat v3.3.0's runtime template fetching.
- **Lesson:** `npm version minor` requires a clean git working dir — committed the source change first, then bumped, then built/tested/published. The deprecation warnings on `server.tool(name, desc, schema, handler)` signature are pre-existing across all tools (MCP SDK changed signature); my new tool follows the same form for consistency. Cleanup is a future repo-wide refactor.

## 2026-08-03 — MCP SDK v2, published 0.13.0, HTTP transport started
- **Done:** Migrated to SDK v2 (HAR-1451, #7) — package split, `serveStdio(factory)`, zod 3→4, `z.object()` wrap at one boundary, `engines: node >=20`, `tools/list` cache hint. Published **0.13.0**. Also #8 js-yaml 4.3.1 (GHSA-52cp-r559-cp3m, reachable from `install_method_spec`'s untrusted YAML), #9 first-ever CI (test on Node 20/24 + weekly audit), #10 CI fix. `npm audit` 11 → 0 runtime; lockfile −1092 lines. Then HAR-602 design + plan committed and Tasks 1–2 built on `feat/har-602-http-transport` (pushed): tools extracted to `src/tools.ts`, every handler takes its own `HarmonicaClient`. 39 tests.
- **Decisions:** v2's factory is fed by a `registrations[]` array replayed per server, so no 700-line re-indent and HAR-602 needs no rework. HTTP will use per-request `Authorization: Bearer` (no OAuth — HAR-484 builds that properly), one binary with `MCP_TRANSPORT=http`, stdio default, and two deliberate boot failures.
- **State:** master @ 0.13.0 published + tagged, CI green. `feat/har-602-http-transport` pushed, Tasks 3–5 not started; ledger at `.superpowers/sdd/2026-08-03-har-602-http-transport-plan/progress.md`.
- **Next:** HAR-602 Task 3 (`src/http.ts`). Task 5 (Railway) needs a domain decision.
- **Closes the 2026-05-23 note's open item:** "the deprecation warnings on `server.tool(...)` are pre-existing across all tools; cleanup is a future repo-wide refactor" — that refactor is this migration.
- **Lesson:** never DELETE `package-lock.json` to resolve a conflict — regenerating on Windows drops other platforms' optional deps and `npm ci` on Linux is the only thing that notices. Also: probe an unfamiliar SDK by running it, not by reading bundled `.d.mts` — three plan facts were wrong until probed (`createMcpHandler` returns an object, SSE body, no `Mcp-*` headers).
