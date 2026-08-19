import { describe, it, expect, vi, afterEach } from 'vitest';
import { describeChainOutcome, describeWidget } from './tools.js';
import { HarmonicaClient } from './client.js';

afterEach(() => vi.restoreAllMocks());

/**
 * Both renderers exist for the same reason: the server now reports something
 * the client used to throw away, and a field that reaches the client but not
 * the caller's screen is still a silent degradation.
 */

describe('describeChainOutcome', () => {
  it('reports a started chain with its instance id', () => {
    const out = describeChainOutcome({
      status: 'started',
      chainInstanceId: 'ci-1',
      stepId: 'cis-0',
    }).join('\n');

    expect(out).toContain('started');
    expect(out).toContain('ci-1');
  });

  it('says plainly that a roster_incomplete session is NOT a chain', () => {
    // The case that motivated HAR-1582. Before this, the tool printed
    // "Session created!" and nothing else, so a caller had no way to know the
    // methodology was not running.
    const out = describeChainOutcome({
      status: 'roster_incomplete',
      message: 'roles are unassigned',
    }).join('\n');

    expect(out).toContain('NOT STARTED');
    expect(out).toContain('roles are unassigned');
    expect(out).toContain('roster');
    // Names the remedy, since the caller is usually an agent that can apply it.
    expect(out).toMatch(/re-create/i);
  });

  it.each([
    ['step_cap_exceeded', { status: 'step_cap_exceeded', message: 'limit hit' }],
    ['project_cap_exceeded', { status: 'project_cap_exceeded', message: 'too many projects' }],
    ['unsupported', { status: 'unsupported' }],
  ] as const)('marks %s as NOT STARTED', (_label, chain) => {
    expect(describeChainOutcome(chain as never).join('\n')).toContain('NOT STARTED');
  });

  it('does not shout about a noop, which is not a degradation', () => {
    const out = describeChainOutcome({ status: 'noop', reason: 'not_a_chain' }).join('\n');
    expect(out).not.toContain('NOT STARTED');
    expect(out).toContain('not_a_chain');
  });
});

describe('describeWidget', () => {
  it('lists the items of a RankingList so the caller can actually answer', () => {
    // The production symptom: the facilitator's prose said "Drag to rank them
    // from hardest to predict to most manageable" while the three items lived
    // only inside the spec. Rendering them is what makes that answerable.
    const out = describeWidget({
      root: {
        type: 'RankingList',
        props: {
          items: ['load variance', 'migration interactions', 'nobody watching'],
          instruction: 'Rank from hardest to predict to most manageable',
        },
        children: [],
      },
    }).join('\n');

    expect(out).toContain('[RankingList]');
    expect(out).toContain('Rank from hardest to predict');
    expect(out).toContain('1. load variance');
    expect(out).toContain('3. nobody watching');
    expect(out).toContain('chat_message');
  });

  it('renders a RatingScale with its bounds and end labels', () => {
    const out = describeWidget({
      root: {
        type: 'RatingScale',
        props: {
          min: 1,
          max: 5,
          label: 'How confident are you?',
          minLabel: 'Not confident',
          maxLabel: 'Very confident',
        },
        children: [],
      },
    }).join('\n');

    expect(out).toContain('[RatingScale]');
    expect(out).toContain('How confident are you?');
    expect(out).toContain('Scale 1 (Not confident) to 5 (Very confident)');
  });

  it('renders a select from `options` rather than `items`', () => {
    const out = describeWidget({
      root: {
        type: 'SingleSelect',
        props: { label: 'Pick one', options: ['A', 'B'] },
        children: [],
      },
    }).join('\n');

    expect(out).toContain('1. A');
    expect(out).toContain('2. B');
  });

  it('survives a spec with no label and no options', () => {
    // Defensive: props is Record<string, unknown> on the wire, so a future
    // widget type must not make the renderer throw mid-conversation.
    const out = describeWidget({
      root: { type: 'MultiSelect', props: {}, children: [] },
    }).join('\n');

    expect(out).toContain('[MultiSelect]');
  });
});

describe('HarmonicaClient.createSession', () => {
  it('sends roster in the POST body and returns the chain outcome', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 's-1',
          topic: 'T',
          goal: 'G',
          status: 'active',
          participant_count: 0,
          created_at: '2026-08-19T00:00:00Z',
          updated_at: '2026-08-19T00:00:00Z',
          join_url: 'https://app.harmonica.chat/chat?s=s-1',
          chain: { status: 'roster_incomplete', message: 'roles are unassigned' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new HarmonicaClient({
      baseUrl: 'https://app.harmonica.chat',
      apiKey: 'hm_live_test',
    });

    const res = await client.createSession({
      topic: 'T',
      goal: 'G',
      template_id: 'delphi-panel-chain',
      roster: [{ email: 'a@example.com', rolesByStep: { '0': 'expert' } }],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.roster).toEqual([{ email: 'a@example.com', rolesByStep: { '0': 'expert' } }]);
    expect(res.chain).toEqual({ status: 'roster_incomplete', message: 'roles are unassigned' });
  });
});
