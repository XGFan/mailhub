import type {
  IngestRunResponse,
  MailDetail,
  PortalSettings,
  SearchField,
  SearchResponse,
} from '@mailhub/shared';

/** Base path for the portal API. In dev, Vite proxies `/api` → the backend. */
const API_BASE = '/api';

/** A typed error carrying the HTTP status when the server responded. */
export class ApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...init,
    });
  } catch {
    throw new ApiError('Network error — is the portal reachable?');
  }
  if (!res.ok) {
    throw new ApiError(`Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Query parameters accepted by the search endpoint (client shape). */
export interface SearchParams {
  q?: string;
  field?: SearchField;
  page?: number;
  pageSize?: number;
  includeSpam?: boolean;
}

export const api = {
  searchMails(params: SearchParams, signal?: AbortSignal): Promise<SearchResponse> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.field) qs.set('field', params.field);
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params.includeSpam) qs.set('includeSpam', 'true');
    const query = qs.toString();
    return request<SearchResponse>(`/mails${query ? `?${query}` : ''}`, { signal });
  },

  getMail(id: string, signal?: AbortSignal): Promise<MailDetail> {
    return request<MailDetail>(`/mails/${encodeURIComponent(id)}`, { signal });
  },

  runIngest(): Promise<IngestRunResponse> {
    return request<IngestRunResponse>('/ingest/run', { method: 'POST' });
  },

  getSettings(signal?: AbortSignal): Promise<PortalSettings> {
    return request<PortalSettings>('/settings', { signal });
  },

  updateSettings(settings: PortalSettings): Promise<PortalSettings> {
    return request<PortalSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  /** Force-download URL for the raw `.eml`. Server sets Content-Disposition. */
  rawUrl(id: string): string {
    return `${API_BASE}/mails/${encodeURIComponent(id)}/raw`;
  },

  /** Force-download URL for an attachment. Server sets Content-Disposition. */
  attachmentUrl(id: string): string {
    return `${API_BASE}/attachments/${encodeURIComponent(id)}`;
  },
};
