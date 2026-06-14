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
