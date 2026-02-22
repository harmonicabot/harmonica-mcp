#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { HarmonicaClient } from './client.js';

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

const server = new McpServer({
  name: 'harmonica',
  version: '0.1.0',
});

// ─── Tools ───────────────────────────────────────────────────────────

server.tool(
  'list_sessions',
  'List Harmonica deliberation sessions you have access to',
  {
    status: z.enum(['active', 'completed']).optional().describe('Filter by status'),
    query: z.string().optional().describe('Search by topic or goal'),
    limit: z.number().min(1).max(100).optional().describe('Results per page (default 20)'),
  },
  async ({ status, query, limit }) => {
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

server.tool(
  'get_session',
  'Get details of a specific Harmonica session',
  {
    session_id: z.string().describe('Session ID (UUID)'),
  },
  async ({ session_id }) => {
    const s = await client.getSession(session_id);
    const text = [
      `**${s.topic}**`,
      `Status: ${s.status} | Participants: ${s.participant_count}`,
      `Goal: ${s.goal}`,
      s.critical ? `Critical: ${s.critical}` : null,
      s.context ? `Context: ${s.context}` : null,
      s.summary ? `\nSummary:\n${s.summary}` : null,
      `\nCreated: ${s.created_at}`,
    ]
      .filter(Boolean)
      .join('\n');
    return { content: [{ type: 'text', text }] };
  },
);

server.tool(
  'get_responses',
  'Get participant responses for a Harmonica session. Returns structured data with participant IDs, message IDs, timestamps, and full conversation threads (both user and assistant messages).',
  {
    session_id: z.string().describe('Session ID (UUID)'),
  },
  async ({ session_id }) => {
    const result = await client.getSessionResponses(session_id);
    if (!result.data.length) {
      return { content: [{ type: 'text', text: 'No responses yet.' }] };
    }

    const structured = result.data.map((p) => ({
      participant_id: p.participant_id,
      display_name: p.participant_name || 'Anonymous',
      active: p.active,
      message_count: p.messages.filter((m) => m.role === 'user').length,
      messages: p.messages.map((m) => ({
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

server.tool(
  'get_summary',
  'Get the AI-generated summary for a Harmonica session',
  {
    session_id: z.string().describe('Session ID (UUID)'),
  },
  async ({ session_id }) => {
    const result = await client.getSessionSummary(session_id);
    const text = result.summary || 'No summary available yet (session may still be active).';
    return { content: [{ type: 'text', text }] };
  },
);

server.tool(
  'search_sessions',
  'Search Harmonica sessions by topic or goal keywords',
  {
    query: z.string().describe('Search keywords'),
    status: z.enum(['active', 'completed']).optional().describe('Filter by status'),
  },
  async ({ query, status }) => {
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

server.tool(
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
  },
  async ({ topic, goal, context, critical, prompt, template_id, cross_pollination }) => {
    const session = await client.createSession({
      topic,
      goal,
      context,
      critical,
      prompt,
      template_id,
      cross_pollination,
    });
    const text = [
      `Session created!`,
      ``,
      `  Topic:    ${session.topic}`,
      `  ID:       ${session.id}`,
      `  Status:   ${session.status}`,
      `  Join URL: ${session.join_url}`,
      ``,
      `Share the join URL with participants to start the session.`,
    ].join('\n');
    return { content: [{ type: 'text', text }] };
  },
);

// ─── Start ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
