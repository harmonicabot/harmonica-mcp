/**
 * HTTP client for the Harmonica REST API v1.
 * All methods throw on HTTP errors.
 */

export interface HarmonicaClientConfig {
  baseUrl: string;
  apiKey: string;
}

export class HarmonicaClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: HarmonicaClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Harmonica API error: ${message}`);
    }

    return res.json() as Promise<T>;
  }

  async getMe() {
    return this.request<{
      id: string;
      email: string;
      name: string | null;
      subscription_status: string;
    }>('/me');
  }

  async listSessions(params?: {
    status?: 'active' | 'completed';
    q?: string;
    limit?: number;
    offset?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.q) query.set('q', params.q);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();

    return this.request<{
      data: Array<{
        id: string;
        topic: string;
        goal: string;
        status: string;
        participant_count: number;
        created_at: string;
        updated_at: string;
      }>;
      pagination: { total: number; limit: number; offset: number };
    }>(`/sessions${qs ? `?${qs}` : ''}`);
  }

  async getSession(id: string) {
    return this.request<{
      id: string;
      topic: string;
      goal: string;
      critical: string | null;
      context: string | null;
      status: string;
      summary: string | null;
      participant_count: number;
      created_at: string;
      updated_at: string;
    }>(`/sessions/${id}`);
  }

  async getSessionQuestions(sessionId: string) {
    return this.request<{
      data: Array<{ id: string; text: string; position: number }>;
    }>(`/sessions/${sessionId}/questions`);
  }

  async getSessionResponses(sessionId: string) {
    return this.request<{
      data: Array<{
        participant_id: string;
        participant_name: string | null;
        active: boolean;
        messages: Array<{
          id: string;
          role: 'user' | 'assistant';
          content: string;
          created_at: string;
        }>;
      }>;
    }>(`/sessions/${sessionId}/responses`);
  }

  async submitResponse(sessionId: string, content: string) {
    return this.request<{
      id: string;
      session_id: string;
      content: string;
      created_at: string;
    }>(`/sessions/${sessionId}/responses`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  async createSession(params: {
    topic: string;
    goal: string;
    context?: string;
    critical?: string;
    prompt?: string;
    template_id?: string;
    cross_pollination?: boolean;
  }) {
    return this.request<{
      id: string;
      topic: string;
      goal: string;
      status: string;
      participant_count: number;
      created_at: string;
      updated_at: string;
      join_url: string;
    }>('/sessions', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getSessionSummary(sessionId: string) {
    return this.request<{
      session_id: string;
      summary: string | null;
      generated_at: string | null;
    }>(`/sessions/${sessionId}/summary`);
  }
}
