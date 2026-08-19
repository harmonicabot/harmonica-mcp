/**
 * HTTP client for the Harmonica REST API v1.
 * All methods throw on HTTP errors.
 */

export interface HarmonicaClientConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * A structured widget the facilitator emitted on a turn (HAR-441).
 *
 * The facilitator mirrors every widget into the prose of `content`, so a client
 * that ignores this field shows the participant an instruction to operate a
 * control that was never rendered — "Drag to rank these", with nothing to drag.
 * Rendering it as text is what an MCP caller can do instead.
 *
 * Absent when the turn produced no widget, which is the common case: the server
 * caps widgets at roughly one per four assistant turns.
 */
export interface WidgetSpec {
  root: {
    type: 'SingleSelect' | 'MultiSelect' | 'RatingScale' | 'RankingList';
    props: Record<string, unknown>;
    children: string[];
  };
}

/**
 * Outcome of chain bootstrap on session creation (HAR-1582).
 *
 * Present only when `template_id` named a chain template. Anything other than
 * `started` or `resumed` means the session was created and is real, but is NOT
 * running as a chain — so this field, not the 201, is what says whether the
 * methodology is actually running. `roster_incomplete` is the common one:
 * several chain templates declare roles and cannot start without a roster.
 */
export type ChainOutcome =
  | { status: 'started' | 'resumed'; chainInstanceId: string; stepId: string }
  | { status: 'noop'; reason: string }
  | { status: 'unsupported' }
  | { status: 'roster_incomplete'; message: string }
  | { status: 'step_cap_exceeded'; message: string }
  | { status: 'project_cap_exceeded'; message: string };

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

export interface ApiProject {
  id: string;
  title: string;
  description: string | null;
  status: string;
  is_public: boolean;
  created_at: string;
}

export interface ApiSensemakingTopic {
  workspace_id: string;
  enabled: boolean;
  slug: string | null;
  theme: string | null;
  title: string | null;
  description: string | null;
  intro: string | null;
  faq: Array<{ q: string; a: string }> | null;
  group_count: number;
  statement_count: number;
  voter_count: number;
  computed_at: string | null;
  gallery_status: string;
  reasoning_lens_enabled: boolean;
  created_at: string;
}

export class HarmonicaClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: HarmonicaClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  /**
   * Builds a public-facing URL under this client's base URL, e.g. for a session/topic link shown
   * back to the caller. A purpose-built accessor rather than exposing `baseUrl` itself — callers
   * get exactly the derived string they need without a raw value to build arbitrary URLs against
   * (this package publishes `dist/`, so `client.js` is reachable by deep import). `baseUrl` never
   * carries a trailing slash (stripped above), so a leading slash is enforced on `path` here to
   * avoid ever concatenating into a double slash regardless of what the caller passes.
   */
  publicUrl(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const res = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (res.status === 429 && attempt < maxRetries - 1) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
        const waitMs = (retryAfter + 1) * 1000; // +1s buffer
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = body?.error?.message || `HTTP ${res.status}`;
        throw new Error(`Harmonica API error ${res.status}: ${message}`);
      }

      return res.json() as Promise<T>;
    }

    throw new Error('Harmonica API error: max retries exceeded');
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

  async listMeetings(params?: {
    status?: 'scheduled' | 'joining' | 'in_call' | 'recording' | 'transcribing' | 'ready' | 'failed' | 'cancelled';
    limit?: number;
    offset?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();

    return this.request<{
      data: Array<{
        id: string;
        title: string;
        meeting_url: string;
        meeting_provider: string;
        starts_at: string;
        ends_at: string | null;
        timezone: string | null;
        status: string;
        error_code: string | null;
        error_message: string | null;
      }>;
      pagination: { total: number; limit: number; offset: number };
    }>(`/meetings${qs ? `?${qs}` : ''}`);
  }

  async getTranscript(meetingId: string) {
    return this.request<{
      id: string;
      meeting_id: string;
      provider: string;
      model: string;
      language: string | null;
      status: string;
      error_code: string | null;
      error_message: string | null;
      completed_at: string | null;
      utterances: Array<{
        sequence: number;
        speaker_id: string | null;
        speaker_name: string | null;
        speaker_email: string | null;
        start_ms: number | null;
        end_ms: number | null;
        text: string;
        language: string | null;
      }>;
    }>(`/meetings/${meetingId}/transcript`);
  }

  async getSession(id: string) {
    return this.request<{
      id: string;
      topic: string;
      goal: string;
      critical: string | null;
      context: string | null;
      prompt: string | null;
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

  async getSessionResponses(sessionId: string, params?: {
    mode?: 'list';
    since?: string;
    name?: string;
    min_messages?: number;
    limit?: number;
    sort?: 'newest' | 'oldest';
  }) {
    const query = new URLSearchParams();
    if (params?.mode) query.set('mode', params.mode);
    if (params?.since) query.set('since', params.since);
    if (params?.name) query.set('name', params.name);
    if (params?.min_messages) query.set('min_messages', String(params.min_messages));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.sort) query.set('sort', params.sort);
    const qs = query.toString();

    return this.request<{
      data: Array<{
        participant_id: string;
        participant_name: string | null;
        active: boolean;
        message_count?: number;
        first_message_at?: string | null;
        last_message_at?: string | null;
        messages?: Array<{
          id: string;
          role: 'user' | 'assistant';
          content: string;
          created_at: string;
        }>;
      }>;
    }>(`/sessions/${sessionId}/responses${qs ? `?${qs}` : ''}`);
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

  async chat(sessionId: string, body: {
    content: string;
    participant_id: string;
    participant_name: string;
  }) {
    return this.request<{
      message: {
        role: 'assistant';
        content: string;
        is_final: boolean;
        widget_spec?: WidgetSpec;
      };
      thread_id: string;
    }>(`/sessions/${sessionId}/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async chatQuestions(sessionId: string, body: {
    participant_id: string;
    participant_name: string;
    answers: Array<{ question_id: string; answer: string }>;
  }) {
    return this.request<{
      message: {
        role: 'assistant';
        content: string;
        is_final: boolean;
        widget_spec?: WidgetSpec;
      };
      thread_id: string;
    }>(`/sessions/${sessionId}/chat/questions`, {
      method: 'POST',
      body: JSON.stringify(body),
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
    widgets_enabled?: boolean;
    results_visibility?: 'public' | 'participants' | 'host';
    project_id?: string;
    distribution?: Array<{ channel: string; group_id: string }>;
    questions?: Array<{
      text: string;
      type?: 'Short field' | 'Email' | 'Options';
      required?: boolean;
      options?: string[];
    }>;
    roster?: Array<{
      email: string;
      displayName?: string;
      auth0Sub?: string;
      rolesByStep?: Record<string, string>;
    }>;
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
      chain?: ChainOutcome;
    }>('/sessions', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async updateSession(id: string, params: {
    topic?: string;
    goal?: string;
    context?: string;
    critical?: string;
    prompt?: string;
    summary_prompt?: string;
    prompt_summary?: string;
    prompt_generated_from?: {
      topic: string;
      goal: string;
      critical: string;
      context: string;
    } | null;
    cross_pollination?: boolean;
    widgets_enabled?: boolean;
    results_visibility?: 'public' | 'participants' | 'host';
    project_id?: string | null;
    welcome_message?: string;
    meta_description?: string;
    intro_video_url?: string | null;
    template_id?: string | null;
    platform_guidelines_override?: string | null;
    questions?: Array<{
      text: string;
      type?: 'Short field' | 'Email' | 'Options';
      required?: boolean;
      options?: string[];
    }>;
    distribution?: Array<{ channel: string; group_id: string }>;
  }) {
    return this.request<{
      id: string;
      topic: string;
      goal: string;
      critical: string | null;
      context: string | null;
      prompt: string | null;
      status: string;
      summary: string | null;
      session_md: string | null;
      participant_count: number;
      created_at: string;
      updated_at: string;
    }>(`/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  }

  async listTelegramGroups(): Promise<
    Array<{
      group_id: string;
      group_name: string | null;
      topic_id: number | null;
      created_at: string;
    }>
  > {
    const res = await this.request<{
      data: Array<{
        group_id: string;
        group_name: string | null;
        topic_id: number | null;
        created_at: string;
      }>;
    }>('/integrations/telegram/groups');
    return res.data;
  }

  async getSessionSummary(sessionId: string) {
    return this.request<{
      session_id: string;
      summary: string | null;
      generated_at: string | null;
    }>(`/sessions/${sessionId}/summary`);
  }

  async generateSummary(sessionId: string) {
    return this.request<{
      session_id: string;
      summary: string | null;
      generated_at: string | null;
    }>(`/sessions/${sessionId}/summary`, {
      method: 'POST',
    });
  }

  async createTemplate(values: {
    title: string;
    description?: string | null;
    template_type?: 'single' | 'chain';
    chain_config?: unknown;
    is_public?: boolean;
    source_provenance?: { spec_id: string; spec_version: string; registry: string };
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
    source_provenance?: { spec_id: string; spec_version: string; registry: string };
    force?: boolean;
  }) {
    return this.request<ApiTemplate>(`/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  }

  async listTemplates() {
    return this.request<{ data: ApiTemplate[] }>('/templates');
  }

  async createProject(values: { title: string; description?: string | null }) {
    return this.request<ApiProject>('/projects', {
      method: 'POST',
      body: JSON.stringify(values),
    });
  }

  async listProjects(params?: { limit?: number; offset?: number }) {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return this.request<{
      data: ApiProject[];
      pagination: { total: number; limit: number; offset: number };
    }>(`/projects${qs ? `?${qs}` : ''}`);
  }

  async getProject(id: string) {
    return this.request<ApiProject & { session_ids: string[] }>(`/projects/${id}`);
  }

  async updateProject(id: string, values: { title?: string; description?: string }) {
    return this.request<ApiProject>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  }

  async deleteProject(id: string) {
    return this.request<ApiProject>(`/projects/${id}`, {
      method: 'DELETE',
    });
  }

  async createUnconferenceTopic(projectId: string, values: { title: string; body?: string }) {
    return this.request<{
      itemId: string;
      topicId: string;
      status: string;
    }>(`/projects/${projectId}/unconference/topics`, {
      method: 'POST',
      body: JSON.stringify(values),
    });
  }

  async getSensemakingTopic(projectId: string) {
    return this.request<{ data: ApiSensemakingTopic | null }>(
      `/projects/${projectId}/sensemaking`,
    );
  }

  async publishSensemakingTopic(
    projectId: string,
    values: {
      slug?: string | null;
      title?: string | null;
      description?: string | null;
      intro?: string | null;
      faq?: Array<{ q: string; a: string }> | null;
      theme?: string | null;
      enabled?: boolean;
      reasoningLensEnabled?: boolean;
      knowledgeStatementsEnabled?: boolean;
    },
  ) {
    return this.request<{ data: ApiSensemakingTopic }>(
      `/projects/${projectId}/sensemaking`,
      {
        method: 'PATCH',
        body: JSON.stringify(values),
      },
    );
  }
}
