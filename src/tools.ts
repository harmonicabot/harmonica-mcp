import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { HarmonicaClient, type ChainOutcome, type WidgetSpec } from './client.js';
import { parseMethodSpec, toChainConfig } from './methodSpec.js';

/**
 * Render the chain bootstrap outcome as text (HAR-1582).
 *
 * A chain template that fails to bootstrap still yields a real, paid-for
 * session, so the API returns 201 either way. Without this the tool printed an
 * unconditional "Session created!" and the caller had to query the database to
 * discover the methodology was never running — the silent degradation the issue
 * was filed about. Every non-started status therefore says so in plain words
 * AND names the fix, because the caller is usually an agent that can apply it.
 */
export function describeChainOutcome(chain: ChainOutcome): string[] {
  switch (chain.status) {
    case 'started':
    case 'resumed':
      return [
        `  Chain:    ${chain.status} — step 1 is live at the join URL above.`,
        `            Instance ${chain.chainInstanceId}`,
      ];
    case 'roster_incomplete':
      return [
        `  Chain:    NOT STARTED — this template assigns roles and no roster was given.`,
        `            ${chain.message}`,
        `            The session exists and works, but it is a single session, not a chain.`,
        `            Re-create it with a \`roster\` to run the methodology as intended.`,
      ];
    case 'step_cap_exceeded':
      return [
        `  Chain:    NOT STARTED — this plan's chain step limit was reached.`,
        `            ${chain.message}`,
        `            The session exists as a single session.`,
      ];
    case 'project_cap_exceeded':
      return [
        `  Chain:    NOT STARTED — a chain needs its own project and the active-project limit was reached.`,
        `            ${chain.message}`,
        `            Archive or delete a project, then re-create this session.`,
      ];
    case 'unsupported':
      return [
        `  Chain:    NOT STARTED — this template's chain strategy is not supported.`,
        `            The session exists as a single session.`,
      ];
    case 'noop':
      return [`  Chain:    not applicable (${chain.reason}).`];
  }
}

/**
 * Render a facilitator widget as text (HAR-441 / HAR-910).
 *
 * The facilitator mirrors the widget into the prose of `content`, so a caller
 * that drops this field is told to "drag to rank these" with nothing to drag.
 * An MCP caller cannot draw a control, but it can be shown the options — which
 * is enough to answer in the next `chat_message`.
 */
export function describeWidget(spec: WidgetSpec): string[] {
  const { type, props } = spec.root;
  const out = [``, `[${type}]`];
  const label = typeof props.label === 'string' ? props.label
    : typeof props.instruction === 'string' ? props.instruction
    : null;
  if (label) out.push(label);

  const options = Array.isArray(props.options) ? props.options
    : Array.isArray(props.items) ? props.items
    : null;
  if (options) options.forEach((o, i) => out.push(`  ${i + 1}. ${String(o)}`));

  if (typeof props.min === 'number' && typeof props.max === 'number') {
    const lo = typeof props.minLabel === 'string' ? ` (${props.minLabel})` : '';
    const hi = typeof props.maxLabel === 'string' ? ` (${props.maxLabel})` : '';
    out.push(`  Scale ${props.min}${lo} to ${props.max}${hi}`);
  }
  out.push(`Answer in your next chat_message.`);
  return out;
}

/**
 * SEP-2549. The tool catalog is identical for every caller and only changes when we publish, so
 * callers may cache it and keep their prompt caches warm across reconnects. `public` is correct
 * here precisely because nothing in the list varies by API key.
 */
export const TOOLS_LIST_TTL_MS = 60 * 60 * 1000;

/**
 * Tool registrations, collected at module load and replayed onto each server the factory builds.
 *
 * v2's `serveStdio` takes a FACTORY rather than a built server, because the stateless core
 * (SEP-2575/SEP-2567) lets the SDK construct one server per connection. Collecting registrations
 * rather than binding them to a module-level singleton keeps that contract honest — over stdio
 * there is only ever one connection, but HAR-602's HTTP transport, where per-request servers
 * genuinely matter, then needs no rework here.
 */
type Registration = (server: McpServer, client: HarmonicaClient) => void;
const registrations: Registration[] = [];

/**
 * Registers one tool.
 *
 * The `z.object()` wrap happens HERE, once, rather than at each of the 22 call sites. Raw-shape
 * `inputSchema` still works — the SDK auto-wraps it — but it is deprecated, and a single boundary
 * means a tool added later cannot land on the deprecated path by someone forgetting to wrap.
 *
 * Each handler also receives the `HarmonicaClient` for the connection it is being run on, rather
 * than closing over a module-level singleton — HTTP (HAR-602) serves multiple callers with
 * different API keys, so the client cannot be ambient module state.
 */
function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  handler: (
    args: z.infer<z.ZodObject<S>>,
    client: HarmonicaClient,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
): void {
  registrations.push((server, client) => {
    server.registerTool(name, { description, inputSchema: z.object(shape) }, ((args: z.infer<z.ZodObject<S>>) => handler(args, client)) as never);
  });
}

// ─── Tools ───────────────────────────────────────────────────────────

tool(
  'list_sessions',
  'List Harmonica deliberation sessions you have access to',
  {
    status: z.enum(['active', 'completed']).optional().describe('Filter by status'),
    query: z.string().optional().describe('Search by topic or goal'),
    limit: z.number().min(1).max(100).optional().describe('Results per page (default 20)'),
  },
  async ({ status, query, limit }, client) => {
    const result = await client.listSessions({ status, q: query, limit });
    const lines = result.data.map(
      (s) => `[${s.status}] ${s.topic} (${s.participant_count} participants) — ${s.id}`,
    );
    const text = lines.length
      ? `${result.pagination.total} sessions found:\n\n${lines.join('\n')}`
      : 'No sessions found.';
    return { content: [{ type: 'text', text }] };
  },
);

tool(
  'get_session',
  'Get details of a specific Harmonica session',
  {
    session_id: z.string().describe('Session ID (UUID)'),
  },
  async ({ session_id }, client) => {
    const s = await client.getSession(session_id);
    const text = [
      `**${s.topic}**`,
      `Status: ${s.status} | Participants: ${s.participant_count}`,
      `Goal: ${s.goal}`,
      s.critical ? `Critical: ${s.critical}` : null,
      s.context ? `Context: ${s.context}` : null,
      s.prompt ? `\nFacilitation Prompt:\n${s.prompt}` : null,
      s.summary ? `\nSummary:\n${s.summary}` : null,
      `\nCreated: ${s.created_at}`,
    ]
      .filter(Boolean)
      .join('\n');
    return { content: [{ type: 'text', text }] };
  },
);

tool(
  'list_meetings',
  'List personal calendar meetings captured by the Harmonica notetaker',
  {
    status: z.enum(['scheduled', 'joining', 'in_call', 'recording', 'transcribing', 'ready', 'failed', 'cancelled']).optional().describe('Filter by meeting status'),
    from: z.iso.datetime({ offset: true }).optional().describe('Include meetings starting at or after this ISO timestamp'),
    to: z.iso.datetime({ offset: true }).optional().describe('Include meetings starting before this ISO timestamp'),
    updated_since: z.iso.datetime({ offset: true }).optional().describe('Include meetings updated at or after this ISO timestamp'),
    limit: z.number().min(1).max(100).optional().describe('Results per page (default 20)'),
    offset: z.number().min(0).optional().describe('Pagination offset'),
    cursor: z.string().optional().describe('Stable pagination cursor returned by the previous page'),
  },
  async ({ status, from, to, updated_since, limit, offset, cursor }, client) => {
    const result = await client.listMeetings({
      status,
      from,
      to,
      updated_since,
      limit,
      offset,
      cursor,
    });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  },
);

tool(
  'get_transcript',
  'Get the persisted transcript and speaker turns for one personal calendar meeting',
  {
    meeting_id: z.string().describe('Meeting ID (UUID)'),
  },
  async ({ meeting_id }, client) => {
    const result = await client.getTranscript(meeting_id);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  },
);

tool(
  'list_participants',
  'List participants in a Harmonica session with metadata (name, message count, timestamps) but WITHOUT full conversations. Use this first to find participants, then get_responses with filters for specific ones.',
  {
    session_id: z.string().describe('Session ID (UUID)'),
    since: z.string().optional().describe('Only participants who joined after this ISO date'),
    name: z.string().optional().describe('Filter by participant name (partial match)'),
    min_messages: z.number().optional().describe('Minimum user message count (skip bounces)'),
    sort: z.enum(['newest', 'oldest']).optional().describe('Sort by join date (default: oldest)'),
  },
  async ({ session_id, since, name, min_messages, sort }, client) => {
    const result = await client.getSessionResponses(session_id, {
      mode: 'list',
      since,
      name,
      min_messages,
      sort,
    });
    if (!result.data.length) {
      return { content: [{ type: 'text', text: 'No participants found.' }] };
    }

    const lines = result.data.map(
      (p) => `- **${p.participant_name || 'Anonymous'}** (${p.message_count} msgs, joined ${p.first_message_at || 'unknown'}) — ID: ${p.participant_id}`,
    );
    return {
      content: [{ type: 'text', text: `${result.data.length} participants:\n\n${lines.join('\n')}` }],
    };
  },
);

tool(
  'get_responses',
  'Get participant responses for a Harmonica session. Returns full conversation threads. Use filters to avoid fetching all data at once for large sessions.',
  {
    session_id: z.string().describe('Session ID (UUID)'),
    since: z.string().optional().describe('Only participants who joined after this ISO date'),
    name: z.string().optional().describe('Filter by participant name (partial match)'),
    min_messages: z.number().optional().describe('Minimum user message count (skip bounces)'),
    limit: z.number().optional().describe('Max number of participants to return'),
    sort: z.enum(['newest', 'oldest']).optional().describe('Sort by join date (default: oldest)'),
  },
  async ({ session_id, since, name, min_messages, limit, sort }, client) => {
    const result = await client.getSessionResponses(session_id, {
      since,
      name,
      min_messages,
      limit,
      sort,
    });
    if (!result.data.length) {
      return { content: [{ type: 'text', text: 'No responses found.' }] };
    }

    const structured = result.data.map((p) => ({
      participant_id: p.participant_id,
      display_name: p.participant_name || 'Anonymous',
      active: p.active,
      message_count: p.message_count ?? p.messages?.filter((m) => m.role === 'user').length ?? 0,
      first_message_at: p.first_message_at,
      messages: p.messages?.map((m) => ({
        message_id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
      })),
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ participants: structured }, null, 2),
      }],
    };
  },
);

tool(
  'get_summary',
  'Get the AI-generated summary for a Harmonica session',
  {
    session_id: z.string().describe('Session ID (UUID)'),
  },
  async ({ session_id }, client) => {
    const result = await client.getSessionSummary(session_id);
    const text = result.summary || 'No summary available yet (session may still be active).';
    return { content: [{ type: 'text', text }] };
  },
);

tool(
  'generate_summary',
  'Generate or regenerate the AI summary for a Harmonica session. Uses the session\'s custom summary_prompt if set, otherwise the default. Requires editor role.',
  {
    session_id: z.string().describe('Session ID (UUID)'),
  },
  async ({ session_id }, client) => {
    const result = await client.generateSummary(session_id);
    const summary = result.summary || 'Summary generation returned no content.';
    const text = `Summary generated for session ${result.session_id} (${result.generated_at}):\n\n${summary}`;
    return { content: [{ type: 'text', text }] };
  },
);

tool(
  'search_sessions',
  'Search Harmonica sessions by topic or goal keywords',
  {
    query: z.string().describe('Search keywords'),
    status: z.enum(['active', 'completed']).optional().describe('Filter by status'),
  },
  async ({ query, status }, client) => {
    const result = await client.listSessions({ q: query, status, limit: 20 });
    if (!result.data.length) {
      return { content: [{ type: 'text', text: `No sessions match "${query}".` }] };
    }

    const lines = result.data.map(
      (s) => `- [${s.status}] **${s.topic}** — ${s.goal}\n  ID: ${s.id}`,
    );
    return {
      content: [{ type: 'text', text: `Found ${result.pagination.total} sessions:\n\n${lines.join('\n')}` }],
    };
  },
);

tool(
  'get_questions',
  'Get pre-session questions (data collection form) for a Harmonica session',
  {
    session_id: z.string().describe('Session ID (UUID)'),
  },
  async ({ session_id }, client) => {
    const result = await client.getSessionQuestions(session_id);
    if (!result.data.length) {
      return { content: [{ type: 'text', text: 'No pre-session questions configured.' }] };
    }

    const lines = result.data.map(
      (q, i) => `${i + 1}. ${q.text}`,
    );
    return {
      content: [{ type: 'text', text: `${result.data.length} pre-session questions:\n\n${lines.join('\n')}` }],
    };
  },
);

tool(
  'create_session',
  'Create a new Harmonica deliberation session and get a shareable join URL',
  {
    topic: z.string().describe('Session topic'),
    goal: z.string().describe('What this session aims to achieve'),
    context: z.string().optional().describe('Background context for participants'),
    critical: z.string().optional().describe('Critical question or constraint'),
    prompt: z.string().optional().describe('Custom facilitation prompt'),
    template_id: z.string().optional().describe('Template ID to use'),
    cross_pollination: z.boolean().optional().describe('Enable idea sharing between participant threads'),
    widgets_enabled: z.boolean().optional().describe('Enable AI-emitted Polls and ratings widgets (SingleSelect, MultiSelect, RatingScale, RankingList) during the session. Default false.'),
    results_visibility: z.enum(['public', 'participants', 'host']).optional().describe('Who can see aggregated results. "host" = owner only; "participants" = anyone who completed (drives end-of-chat "See what others said" link); "public" = anyone with the URL. Defaults to "participants" for MCP-created sessions (programmatic use case usually wants distributed visibility); pass "host" explicitly to keep results private.'),
    project_id: z.string().optional().describe('Attach the new session to a project (workspace) by id, so it is grouped under that project. You must have editor access to the project. Create one with create_project or find one with list_projects.'),
    distribution: z.array(z.object({
      channel: z.string().describe('Distribution channel (e.g. "telegram")'),
      group_id: z.string().describe('Target group identifier'),
    })).optional().describe('Distribution targets for channel integrations'),
    questions: z.array(z.object({
      text: z.string().describe('Question text shown to participants before the session starts'),
      type: z.enum(['Short field', 'Email', 'Options']).optional().describe('Field type. Defaults to "Short field". Use "Email" for email validation; "Options" for a multi-choice select (also pass `options`).'),
      required: z.boolean().optional().describe('Whether the field is required. Defaults to false.'),
      options: z.array(z.string()).optional().describe('Choices when `type` is "Options".'),
    })).optional().describe('Pre-session questions (e.g. name, role, email). Participants answer these before chatting. Pass `type: "Email"` and `required: true` to validate contact details up front.'),
    roster: z.array(z.object({
      email: z.string().describe('Participant email. Used to invite them and to bind them to their role.'),
      displayName: z.string().optional().describe('Display name for the participant'),
      auth0Sub: z.string().optional().describe('Auth0 subject id, when the participant already has a Harmonica account'),
      rolesByStep: z.record(z.string(), z.string()).optional().describe('Role for this participant per chain step, keyed by step index as a string (e.g. {"0": "expert", "1": "reviewer"}).'),
    })).optional().describe('Participants and their per-step roles, for chain templates that declare roles. Several chain templates (Delphi among them) cannot start without this — passing a role-based chain template with no roster creates the session but returns chain.status = "roster_incomplete", meaning it is NOT running as a chain. Ignored for single-session templates.'),
  },
  async ({ topic, goal, context, critical, prompt, template_id, cross_pollination, widgets_enabled, results_visibility, project_id, distribution, questions, roster }, client) => {
    const session = await client.createSession({
      topic,
      goal,
      context,
      critical,
      prompt,
      template_id,
      cross_pollination,
      widgets_enabled,
      // HAR-905 — MCP-created sessions default to 'participants' so the
      // HAR-858 end-of-chat results link is visible by default. The v1 API
      // itself still defaults to 'host' for backwards compat; this is the
      // MCP-layer opinionated default. Caller can override explicitly.
      results_visibility: results_visibility ?? 'participants',
      project_id,
      distribution,
      questions,
      roster,
    });
    const lines = [
      `Session created!`,
      ``,
      `  Topic:    ${session.topic}`,
      `  ID:       ${session.id}`,
      `  Status:   ${session.status}`,
      `  Join URL: ${session.join_url}`,
    ];
    // HAR-1582 — a chain template that fails to bootstrap still returns a real
    // session, so "Session created!" alone is true and misleading at the same
    // time. Say which one happened; silence here is the bug that issue is about.
    if (session.chain) lines.push(``, ...describeChainOutcome(session.chain));
    lines.push(``, `Share the join URL with participants to start the session.`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

tool(
  'update_session',
  'Update session metadata. Mirrors the v1 PATCH /api/v1/sessions/[id] ALLOWED_UPDATE_FIELDS surface. Requires editor role.',
  {
    session_id: z.string().describe('Session ID (UUID)'),
    topic: z.string().optional().describe('Updated session topic'),
    goal: z.string().optional().describe('Updated session goal'),
    context: z.string().optional().describe('Updated background context'),
    critical: z.string().optional().describe('Updated critical question or constraint'),
    prompt: z.string().optional().describe('Updated custom facilitation prompt'),
    summary_prompt: z.string().optional().describe('Updated custom summarization prompt'),
    prompt_summary: z.string().optional().describe('Short summary of the facilitation prompt (HAR-859). Usually written together with `prompt` by the regenerate-facilitation-prompt flow; setting manually outside that flow can confuse the Brief-drift banner.'),
    prompt_generated_from: z.object({
      topic: z.string(),
      goal: z.string(),
      critical: z.string(),
      context: z.string(),
    }).nullable().optional().describe('Snapshot of the Brief fields that produced the current `prompt` (HAR-859). Brief-drift detection compares this against current topic/goal/critical/context.'),
    cross_pollination: z.boolean().optional().describe('Enable/disable idea sharing between participant threads'),
    widgets_enabled: z.boolean().optional().describe('Enable AI-emitted Polls and ratings widgets (SingleSelect, MultiSelect, RatingScale, RankingList). Default false.'),
    results_visibility: z.enum(['public', 'participants', 'host']).optional().describe('Who can see aggregated results. "host" = owner only; "participants" = anyone who completed; "public" = anyone with the URL.'),
    project_id: z.string().nullable().optional().describe('Move the session into a project (workspace) by id, or pass `null` to detach it from all projects. Requires editor access to the target project. Attaching does not remove the session from any OTHER project it belongs to.'),
    welcome_message: z.string().optional().describe('Markdown welcome message shown on the session landing page before participants enter chat.'),
    meta_description: z.string().optional().describe('Session-specific OG meta description for landing-page link previews.'),
    intro_video_url: z.string().nullable().optional().describe('Optional intro video URL embedded on the session landing page. Pass `null` to clear.'),
    template_id: z.string().nullable().optional().describe('Template id that backs this session. Editing without recomposing the prompt (POST /sessions/[id]/regenerate-facilitation-prompt) leaves prompt + template out of sync. Pass `null` to detach.'),
    platform_guidelines_override: z.string().nullable().optional().describe('Per-session override of the Platform Guidelines block in the facilitation prompt (HAR-868). Pass `null` to fall back to the platform default.'),
    questions: z.array(z.object({
      text: z.string().describe('Question text shown to participants before the session starts'),
      type: z.enum(['Short field', 'Email', 'Options']).optional().describe('Field type. Defaults to "Short field".'),
      required: z.boolean().optional().describe('Whether the field is required.'),
      options: z.array(z.string()).optional().describe('Choices when `type` is "Options".'),
    })).optional().describe('Pre-session questions. Replaces the existing pre-survey wholesale.'),
    distribution: z.array(z.object({
      channel: z.string().describe('Distribution channel (e.g. "telegram")'),
      group_id: z.string().describe('Target group identifier'),
    })).optional().describe('Distribution targets for channel integrations'),
  },
  async ({ session_id, ...updates }, client) => {
    // Filter out undefined values
    const fields = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined),
    );

    if (Object.keys(fields).length === 0) {
      return { content: [{ type: 'text', text: 'Error: No fields provided to update.' }] };
    }

    const updated = await client.updateSession(session_id, fields);
    const text = [
      `Session updated!`,
      ``,
      `  Topic:    ${updated.topic}`,
      `  Goal:     ${updated.goal}`,
      `  Status:   ${updated.status}`,
      updated.prompt ? `  Prompt:   ${updated.prompt.substring(0, 100)}${updated.prompt.length > 100 ? '...' : ''}` : null,
      ``,
    ]
      .filter(Boolean)
      .join('\n');
    return { content: [{ type: 'text', text }] };
  },
);

tool(
  'list_telegram_groups',
  'List Telegram groups registered to your Harmonica account for session distribution',
  {},
  async (_args, client) => {
    const groups = await client.listTelegramGroups();

    if (groups.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No Telegram groups registered. Add the Harmonica bot to a Telegram group and run /setup to register it.',
          },
        ],
      };
    }

    const lines = groups.map(
      (g) =>
        `- ${g.group_name ?? 'Unnamed group'} (ID: ${g.group_id})${g.topic_id ? ` [forum topic: ${g.topic_id}]` : ''}`,
    );

    return {
      content: [
        {
          type: 'text',
          text: `Your Telegram groups:\n\n${lines.join('\n')}`,
        },
      ],
    };
  },
);

tool(
  'list_templates',
  "List Harmonica session templates available to your account (public global templates + templates you own / can access). Use to discover what facilitation patterns are configured in the platform — pass the returned id to create_session as template_id to launch a session with that template's stored facilitation_prompt. Returns id, title, description, and template_type (single | chain) for each.",
  {},
  async (_args, client) => {
    const result = await client.listTemplates();

    if (result.data.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No templates available to your account.',
          },
        ],
      };
    }

    const lines = result.data.map(
      (t) =>
        `- ${t.title} (id: \`${t.id}\`, type: ${t.template_type})${t.description ? `\n  ${t.description}` : ''}`,
    );

    return {
      content: [
        {
          type: 'text',
          text: `Available templates (${result.data.length}):\n\n${lines.join('\n')}`,
        },
      ],
    };
  },
);

tool(
  'chat_message',
  'Send a message in a Harmonica session conversation and get the AI facilitator response. Creates a new participant thread if first message.',
  {
    session_id: z.string().describe('Session ID (UUID)'),
    content: z.string().describe('Message content'),
    participant_id: z.string().describe('Unique participant identifier'),
    participant_name: z.string().describe('Display name for the participant'),
  },
  async ({ session_id, content, participant_id, participant_name }, client) => {
    const result = await client.chat(session_id, { content, participant_id, participant_name });
    const finalNote = result.message.is_final ? '\n\n[Session complete for this participant]' : '';
    const widget = result.message.widget_spec
      ? `\n${describeWidget(result.message.widget_spec).join('\n')}`
      : '';
    const text = `**Facilitator:** ${result.message.content}${widget}${finalNote}\n\nThread ID: ${result.thread_id}`;
    return { content: [{ type: 'text', text }] };
  },
);

tool(
  'submit_questions',
  'Submit pre-session question answers and start a facilitated conversation. Returns the opening facilitator message.',
  {
    session_id: z.string().describe('Session ID (UUID)'),
    participant_id: z.string().describe('Unique participant identifier'),
    participant_name: z.string().describe('Display name for the participant'),
    answers: z.array(z.object({
      question_id: z.string().describe('Question ID'),
      answer: z.string().describe('Answer text'),
    })).describe('Array of question answers'),
  },
  async ({ session_id, participant_id, participant_name, answers }, client) => {
    const result = await client.chatQuestions(session_id, { participant_id, participant_name, answers });
    // Same as chat_message — the opening turn can carry a widget too.
    const widget = result.message.widget_spec
      ? `\n${describeWidget(result.message.widget_spec).join('\n')}`
      : '';
    const text = `**Facilitator:** ${result.message.content}${widget}\n\nThread ID: ${result.thread_id}`;
    return { content: [{ type: 'text', text }] };
  },
);

tool(
  'install_method_spec',
  'Install an OFL method spec (the contents of a method.md file) as a runnable Harmonica chain template. Pass the full method.md text as method_md. Use dry_run to preview the generated chain_config without writing anything. Chain templates need a paid (Pro/LTD) account; Free is capped at 3 steps.',
  {
    method_md: z.string().describe('Full contents of the method.md spec file (YAML frontmatter + body).'),
    dry_run: z.boolean().optional().describe('If true, return the generated chain_config without creating a template. Default false.'),
    template_id: z.string().optional().describe('Update this existing template (PATCH) instead of creating a new one.'),
    update_if_exists: z.boolean().optional().describe('If no template_id, update an owned chain template with the same title instead of creating a duplicate. Default false.'),
    is_public: z.boolean().optional().describe('Make the installed template public. Default false — drafts and CC-licensed specs should stay private.'),
    registry: z.string().optional().describe("Registry the spec came from. Default 'Open-Facilitation-Library/method-specs'."),
    force: z.boolean().optional().describe('Overwrite a template that has local admin edits since install. Default false.'),
  },
  async ({ method_md, dry_run, template_id, update_if_exists, is_public, registry, force }, client) => {
    let spec, install;
    try {
      spec = parseMethodSpec(method_md);
      install = toChainConfig(spec);
    } catch (e) {
      return { content: [{ type: 'text', text: `Could not parse method spec: ${(e as Error).message}` }] };
    }

    const provenance = {
      spec_id: spec.frontmatter.id,
      spec_version: spec.frontmatter.version ?? '0.0.0',
      registry: registry ?? 'Open-Facilitation-Library/method-specs',
    };

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
        result = await client.updateTemplate(template_id, { ...values, source_provenance: provenance, force: force ?? false });
        action = 'Updated';
      } else if (update_if_exists) {
        const me = await client.getMe();
        const existing = (await client.listTemplates()).data.find(
          (t) => t.template_type === 'chain' && t.title === install.title && t.created_by === me.id,
        );
        if (existing) {
          result = await client.updateTemplate(existing.id, { ...values, source_provenance: provenance, force: force ?? false });
          action = 'Updated';
        } else {
          result = await client.createTemplate({ ...values, source_provenance: provenance });
          action = 'Created';
        }
      } else {
        result = await client.createTemplate({ ...values, source_provenance: provenance });
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

tool(
  'create_project',
  'Create a Harmonica project (workspace) you own. Use the returned project ID to publish it as a public sensemaking topic via publish_sensemaking_topic, or to scope sessions/templates to the project. Reuse an existing project by passing its ID to those tools instead of creating a new one.',
  {
    title: z.string().describe('Project title'),
    description: z.string().optional().describe('Optional project description (markdown)'),
  },
  async ({ title, description }, client) => {
    const project = await client.createProject({ title, description });
    const text = [
      `Project created!`,
      ``,
      `  Title: ${project.title}`,
      `  ID:    ${project.id}`,
      ``,
      `Publish it as a public sensemaking topic with publish_sensemaking_topic (project_id: ${project.id}).`,
    ].join('\n');
    return { content: [{ type: 'text', text }] };
  },
);

tool(
  'list_projects',
  'List the Harmonica projects (workspaces) you have access to. A project groups related sessions and can be published as a public sensemaking topic. Returns title + id for each.',
  {
    limit: z.number().min(1).max(100).optional().describe('Results per page (default 20)'),
    offset: z.number().min(0).optional().describe('Pagination offset (default 0)'),
  },
  async ({ limit, offset }, client) => {
    const result = await client.listProjects({ limit, offset });
    if (!result.data.length) {
      return { content: [{ type: 'text', text: 'No projects found.' }] };
    }
    const lines = result.data.map(
      (p) => `- ${p.title}${p.status && p.status !== 'active' ? ` [${p.status}]` : ''} — ${p.id}`,
    );
    return {
      content: [{ type: 'text', text: `${result.pagination.total} projects:\n\n${lines.join('\n')}` }],
    };
  },
);

tool(
  'get_project',
  'Get a single Harmonica project (workspace) by id, including the ids of the sessions linked to it.',
  {
    project_id: z.string().describe('Project (workspace) ID'),
  },
  async ({ project_id }, client) => {
    const p = await client.getProject(project_id);
    const text = [
      `**${p.title}**`,
      `ID: ${p.id}`,
      `Status: ${p.status}`,
      p.description ? `Description: ${p.description}` : null,
      `Linked sessions (${p.session_ids.length}): ${p.session_ids.length ? p.session_ids.join(', ') : 'none'}`,
      `Created: ${p.created_at}`,
    ]
      .filter(Boolean)
      .join('\n');
    return { content: [{ type: 'text', text }] };
  },
);

tool(
  'update_project',
  'Rename a Harmonica project (workspace) or update its description. Requires editor access. Pass at least one of title / description.',
  {
    project_id: z.string().describe('Project (workspace) ID'),
    title: z.string().min(1).max(200).optional().describe('New project title'),
    description: z
      .string()
      .max(2000)
      .optional()
      .describe('New project description (markdown). Pass an empty string to clear it.'),
  },
  async ({ project_id, title, description }, client) => {
    const values = Object.fromEntries(
      Object.entries({ title, description }).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(values).length === 0) {
      return {
        content: [{ type: 'text', text: 'Error: provide at least one of title, description.' }],
      };
    }
    const p = await client.updateProject(project_id, values);
    const text = [`Project updated!`, ``, `  Title: ${p.title}`, `  ID:    ${p.id}`].join('\n');
    return { content: [{ type: 'text', text }] };
  },
);

tool(
  'delete_project',
  'Soft-delete a Harmonica project (workspace): it is archived (status=deleted) and the sessions inside it are left intact, just ungrouped. Requires owner access. This never deletes any sessions.',
  {
    project_id: z.string().describe('Project (workspace) ID'),
  },
  async ({ project_id }, client) => {
    const p = await client.deleteProject(project_id);
    const text = `Project "${p.title}" deleted (status: ${p.status}). Its sessions were not deleted.`;
    return { content: [{ type: 'text', text }] };
  },
);

tool(
  'create_unconference_topic',
  'Create a draft topic in an Unconference project. The topic is added to the operational record and mirrored to the connected brain repository. Requires editor access.',
  {
    project_id: z.string().describe('Unconference project ID'),
    title: z.string().min(1).max(240).describe('Canonical draft topic wording'),
    body: z.string().max(10_000).optional().describe('Optional public-safe context for the topic'),
  },
  async ({ project_id, title, body }, client) => {
    const topic = await client.createUnconferenceTopic(project_id, {
      title: title.trim(),
      body: body?.trim() || undefined,
    });
    const text = [
      'Unconference draft topic created!',
      '',
      `  Topic ID: ${topic.topicId}`,
      `  Item ID:  ${topic.itemId}`,
      `  Status:   ${topic.status}`,
      '',
      'The topic will be mirrored to the project brain repository.',
    ].join('\n');
    return { content: [{ type: 'text', text }] };
  },
);

tool(
  'publish_sensemaking_topic',
  "Author and publish a Harmonica project as a public sensemaking topic — the /explore hub entry + the /t/[slug] opinion-landscape page built from the project's sessions. Pass enabled: true with a slug (here or already saved) to publish. Requires editor access to the project. Listing on /explore is a separate admin-curated step.",
  {
    project_id: z.string().describe('Project (workspace) ID, e.g. from create_project'),
    slug: z
      .string()
      .optional()
      .describe('URL handle for /t/[slug] — lowercase words separated by single hyphens. Required to publish (in this call or already saved).'),
    title: z.string().optional().describe('Public topic title (defaults to the project title).'),
    description: z.string().optional().describe('Short public description / framing.'),
    intro: z.string().optional().describe('Host-authored background paragraph shown on the topic page.'),
    faq: z
      .array(z.object({ q: z.string(), a: z.string() }))
      .optional()
      .describe('Up to 10 FAQ entries shown on the topic page.'),
    theme: z.string().optional().describe('Topic category powering the /explore hub filter.'),
    enabled: z
      .boolean()
      .optional()
      .describe('Set true to publish (make /t/[slug] live + build the snapshot), false to unpublish.'),
    reasoning_lens_enabled: z
      .boolean()
      .optional()
      .describe('Opt the embedding-based Reasoning lens in.'),
    knowledge_statements_enabled: z
      .boolean()
      .optional()
      .describe('Source opinion-map statements from project knowledge (claims + tensions).'),
  },
  async ({
    project_id,
    slug,
    title,
    description,
    intro,
    faq,
    theme,
    enabled,
    reasoning_lens_enabled,
    knowledge_statements_enabled,
  }, client) => {
    const values = Object.fromEntries(
      Object.entries({
        slug,
        title,
        description,
        intro,
        faq,
        theme,
        enabled,
        reasoningLensEnabled: reasoning_lens_enabled,
        knowledgeStatementsEnabled: knowledge_statements_enabled,
      }).filter(([, v]) => v !== undefined),
    );

    if (Object.keys(values).length === 0) {
      return {
        content: [
          { type: 'text', text: 'Error: No fields provided. Pass at least a slug + enabled:true to publish.' },
        ],
      };
    }

    try {
      const { data: topic } = await client.publishSensemakingTopic(project_id, values);
      const text = [
        topic.enabled ? `Topic published!` : `Topic settings saved (not published).`,
        ``,
        `  Project:    ${topic.workspace_id}`,
        topic.slug ? `  Slug:       ${topic.slug}` : null,
        topic.theme ? `  Theme:      ${topic.theme}` : null,
        `  Published:  ${topic.enabled ? 'yes' : 'no'}`,
        topic.enabled && topic.slug ? `  Public URL: ${client.publicUrl(`/t/${topic.slug}`)}` : null,
        ``,
        topic.enabled
          ? `The opinion landscape builds from the project's sessions (may take a moment). Listing on /explore needs admin approval.`
          : null,
      ]
        .filter(Boolean)
        .join('\n');
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Publish failed: ${(e as Error).message}` }] };
    }
  },
);

// ─── Server factory ─────────────────────────────────────────────────

/** Builds a fresh server per connection. See the note on `registrations` above. */
export function createServer(client: HarmonicaClient, version: string): McpServer {
  const server = new McpServer(
    { name: 'harmonica', version },
    { cacheHints: { 'tools/list': { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: 'public' } } },
  );
  for (const register of registrations) register(server, client);
  return server;
}
