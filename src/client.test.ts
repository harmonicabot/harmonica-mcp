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

  it('includes source_provenance in the POST body when provided', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 't-2', title: 'M', template_type: 'chain' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new HarmonicaClient({ baseUrl: 'https://app.harmonica.chat', apiKey: 'hm_live_test' });
    await client.createTemplate({
      title: 'M',
      template_type: 'chain',
      chain_config: { steps: [{ id: 's1' }] },
      source_provenance: { spec_id: 's', spec_version: '0.1.0', registry: 'r' },
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init?.body as string).source_provenance).toEqual({
      spec_id: 's',
      spec_version: '0.1.0',
      registry: 'r',
    });
  });
});

describe('HarmonicaClient.createProject', () => {
  it('POSTs to /api/v1/projects with the title body + bearer auth', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'ws-1', title: 'My Topic', status: 'active', is_public: false }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new HarmonicaClient({ baseUrl: 'https://app.harmonica.chat', apiKey: 'hm_live_test' });
    const res = await client.createProject({ title: 'My Topic' });

    expect(res.id).toBe('ws-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://app.harmonica.chat/api/v1/projects');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer hm_live_test');
    expect(JSON.parse(init?.body as string).title).toBe('My Topic');
  });
});

describe('HarmonicaClient.publishSensemakingTopic', () => {
  it('PATCHes to /api/v1/projects/{id}/sensemaking with the publish body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: { workspace_id: 'ws-1', enabled: true, slug: 'my-topic' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new HarmonicaClient({ baseUrl: 'https://app.harmonica.chat', apiKey: 'hm_live_test' });
    const res = await client.publishSensemakingTopic('ws-1', {
      slug: 'my-topic',
      enabled: true,
      reasoningLensEnabled: true,
    });

    expect(res.data.slug).toBe('my-topic');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://app.harmonica.chat/api/v1/projects/ws-1/sensemaking');
    expect(init?.method).toBe('PATCH');
    const body = JSON.parse(init?.body as string);
    expect(body.slug).toBe('my-topic');
    expect(body.enabled).toBe(true);
    expect(body.reasoningLensEnabled).toBe(true);
  });
});

describe('HarmonicaClient project management (HAR-1298)', () => {
  const client = () =>
    new HarmonicaClient({ baseUrl: 'https://app.harmonica.chat', apiKey: 'hm_live_test' });

  it('listProjects GETs /projects with pagination query + bearer auth', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'ws-1', title: 'P' }], pagination: { total: 1, limit: 10, offset: 5 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const res = await client().listProjects({ limit: 10, offset: 5 });

    expect(res.data[0].id).toBe('ws-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://app.harmonica.chat/api/v1/projects?limit=10&offset=5');
    expect(init?.method ?? 'GET').toBe('GET');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer hm_live_test');
  });

  it('getProject GETs /projects/{id} and returns session_ids', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'ws-1', title: 'P', session_ids: ['s-1', 's-2'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const res = await client().getProject('ws-1');

    expect(res.session_ids).toEqual(['s-1', 's-2']);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://app.harmonica.chat/api/v1/projects/ws-1');
  });

  it('updateProject PATCHes /projects/{id} with the update body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'ws-1', title: 'Renamed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const res = await client().updateProject('ws-1', { title: 'Renamed' });

    expect(res.title).toBe('Renamed');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://app.harmonica.chat/api/v1/projects/ws-1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string).title).toBe('Renamed');
  });

  it('deleteProject DELETEs /projects/{id}', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'ws-1', title: 'P', status: 'deleted' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const res = await client().deleteProject('ws-1');

    expect(res.status).toBe('deleted');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://app.harmonica.chat/api/v1/projects/ws-1');
    expect(init?.method).toBe('DELETE');
  });

  it('createSession forwards project_id in the POST body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ id: 's-1', topic: 'T', goal: 'G', status: 'active', join_url: 'x' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await client().createSession({ topic: 'T', goal: 'G', project_id: 'ws-1' });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init?.body as string).project_id).toBe('ws-1');
  });

  it('updateSession forwards project_id: null (detach) in the PATCH body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 's-1', topic: 'T', goal: 'G', status: 'active' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await client().updateSession('s-1', { project_id: null });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.project_id).toBeNull();
    expect('project_id' in body).toBe(true);
  });
});
