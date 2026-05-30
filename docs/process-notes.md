# Process Notes

Append-only per-session log. Format: `## YYYY-MM-DD — [topic]` + Done / Decisions / State / Next (4-6 lines).

## 2026-05-30 — Broaden create_session.questions + complete update_session parity (0.7.1)
- **Done:** `create_session.questions[]` now optionally accepts `type` ('Short field' | 'Email' | 'Options'), `required`, and `options` (PR #2). `update_session` brought to full v1 PATCH `ALLOWED_UPDATE_FIELDS` parity: added `widgets_enabled`, `results_visibility`, `questions` (PR #2) + `prompt_summary`, `prompt_generated_from`, `welcome_message`, `meta_description`, `intro_video_url`, `template_id`, `platform_guidelines_override` (follow-up commit `f90729d`). `client.ts` type mirrors all of the above. Published as `harmonica-mcp@0.7.1` to npm. Pro PR #342 is the matching API-side fix.
- **Decisions:** `prompt_summary` and `prompt_generated_from` docstrings warn that manual edits can confuse Brief-drift detection; `template_id` docstring warns of prompt-template desync without a recompose call. Bumped `0.7.0 → 0.7.1` rather than rewriting the 0.7.0 tag (cleaner history; 0.7.0 was never published to npm).
- **State:** master clean, 0.7.1 live on npm. 8 pre-existing TS strict-mode warnings turned out to be stale `node_modules` (missing `@types/node` despite being in package.json) — fixed by `npm install`, no code change.
- **Next:** None tracked. Open improvements (low priority): MCP `update_session` could also expose the few less-obvious PATCH fields if they ever come up.
